import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, Map as MapIcon, Settings, Eye, EyeOff, Info, CheckCircle2, Search, ZoomIn, ZoomOut, Menu, GitCommit, HelpCircle, RefreshCw, Play, Pause, SkipBack } from 'lucide-react';
import Papa from 'papaparse';

export default function App() {
  const [appState, setAppState] = useState('setup'); // 'setup', 'loading', 'map'
  const [csvLoading, setCsvLoading] = useState(false);
  const [imageSrc, setImageSrc] = useState(null);

  // Split data to handle both types
  const [csvData, setCsvData] = useState({ body: [], touches: [] });
  const [dataSource, setDataSource] = useState('body'); // 'body' | 'touches' | 'combined'

  const [bcidColors, setBcidColors] = useState({});
  const [hiddenBcids, setHiddenBcids] = useState(new Set());
  const [scaleCoordinates, setScaleCoordinates] = useState(false);
  const [resolution, setResolution] = useState({ width: 1743, height: 733 });
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [renderMode, setRenderMode] = useState('dots');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Sidebar tab state: 'legend' | 'stitcher'
  const [sidebarTab, setSidebarTab] = useState('legend');

  // State to hold user-configured track merges (childBCID -> parentBCID)
  const [merges, setMerges] = useState({});
  const [hoveredSuggestion, setHoveredSuggestion] = useState(null);

  // Stitch finder configurable thresholds
  const [maxTimeGapSec, setMaxTimeGapSec] = useState(15);
  const [maxDistPx, setMaxDistPx] = useState(120);

  // Expanded stitch pair detail view
  const [expandedSuggestion, setExpandedSuggestion] = useState(null);

  // Hidden stitch pairs (by suggestion id)
  const [hiddenPairs, setHiddenPairs] = useState(new Set());

  // Legend sort: 'default' | 'points-desc' | 'points-asc' | 'duration-desc' | 'duration-asc'
  const [legendSort, setLegendSort] = useState('points-desc');

  // Journey animation
  const [isAnimating, setIsAnimating] = useState(false);
  const [animProgress, setAnimProgress] = useState(0); // 0–1
  const [animSpeed, setAnimSpeed] = useState(1); // playback multiplier
  const animRafRef = useRef(null);
  const animLastTimeRef = useRef(null);

  // Pattern analysis
  const [gridCols, setGridCols] = useState(6);
  const [gridRows, setGridRows] = useState(4);
  const [dwellRadiusPx, setDwellRadiusPx] = useState(50);
  const [dwellMinSec, setDwellMinSec] = useState(5);
  const [selectedZones, setSelectedZones] = useState(new Set()); // empty = show all
  const [showZoneOverlay, setShowZoneOverlay] = useState(false);

  // Helper to trace up the merge tree to find the ultimate parent track representative
  const getMergedRepresentative = (bcid, currentMerges) => {
    let visited = new Set();
    let current = bcid;
    while (currentMerges[current]) {
      if (visited.has(current)) break; // cycle protection
      visited.add(current);
      current = currentMerges[current];
    }
    return current;
  };

  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Combine body and touch points or fetch individually based on data source
  const activeData = useMemo(() => {
    if (dataSource === 'combined') {
      return [...csvData.body, ...csvData.touches];
    }
    return csvData[dataSource] || [];
  }, [csvData, dataSource]);

  // RFC 4180-compliant CSV row splitter (handles "" escaped quotes inside quoted fields)
  const splitCSVRow = (line) => {
    const fields = [];
    let val = '';
    let inQuotes = false;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (inQuotes) {
        if (c === '"') {
          if (line[j + 1] === '"') { val += '"'; j++; } // escaped ""
          else inQuotes = false;                          // end of quoted field
        } else {
          val += c;
        }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { fields.push(val); val = ''; }
        else { val += c; }
      }
    }
    fields.push(val);
    return fields;
  };

  // Parse CSV function for both Body and Touch points
  const parseCSV = (text) => {
    // Strip UTF-8 BOM and normalize line endings
    const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    if (lines.length < 2) return { body: [], touches: [] };

    const headers = splitCSVRow(lines[0]).map(h => h.trim().toLowerCase());
    console.log('[CSV] headers:', headers);
    console.log('[CSV] total lines:', lines.length);

    const eventTsIdx = headers.indexOf('event_ts');
    const outputsIdx = headers.indexOf('outputs');
    // flat fallback columns (single-output rows)
    const bcidIdx    = headers.indexOf('bcid');
    const floorPtIdx = headers.indexOf('floor_pt_fused');
    const touchesIdx = headers.indexOf('touches');

    console.log('[CSV] outputsIdx:', outputsIdx, 'bcidIdx:', bcidIdx, 'floorPtIdx:', floorPtIdx);

    if (bcidIdx === -1 && outputsIdx === -1) {
      alert(`Error: Could not find a 'bcid' or 'outputs' column.\nColumns found: ${headers.join(', ')}`);
      return { body: [], touches: [] };
    }

    const bodyPoints = [];
    const touchPoints = [];
    let isNormalized = true;

    const addBody = (id, bcid, x, y, timestamp) => {
      if (x > 2 || y > 2) isNormalized = false;
      bodyPoints.push({ id, rowIndex: id, bcid, rawX: x, rawY: y, timestamp, type: 'body' });
    };

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const row = splitCSVRow(lines[i]);

      const tsStr = eventTsIdx !== -1 ? row[eventTsIdx] : null;
      const timestamp = tsStr ? new Date(tsStr).getTime() : i * 100;

      // 1. Try to extract multiple bcids from the `outputs` JSON column
      let extractedFromOutputs = false;
      if (outputsIdx !== -1 && row[outputsIdx]) {
        try {
          if (i === 1) console.log('[CSV] row 1 col count:', row.length, 'outputs snippet:', row[outputsIdx]?.slice(0, 100));
          const outputs = JSON.parse(row[outputsIdx]);
          if (Array.isArray(outputs)) {
            outputs.forEach((entry, oIdx) => {
              const bcid = entry.bcid;
              const fp = entry.floor_pt_fused;
              if (bcid && Array.isArray(fp) && fp.length >= 2) {
                addBody(`b${i}-${oIdx}`, bcid, parseFloat(fp[0]), parseFloat(fp[1]), timestamp);
                extractedFromOutputs = true;
              }
              // Touch points nested inside outputs
              if (entry.touches && Array.isArray(entry.touches)) {
                entry.touches.forEach((touch, tIdx) => {
                  const fp2 = touch.floor_pt;
                  if (fp2 && fp2.x != null && fp2.y != null) {
                    const tx = parseFloat(fp2.x), ty = parseFloat(fp2.y);
                    if (tx > 2 || ty > 2) isNormalized = false;
                    touchPoints.push({ id: `t${i}-${oIdx}-${tIdx}`, rowIndex: i, bcid, rawX: tx, rawY: ty, timestamp, type: 'touch' });
                  }
                });
              }
            });
          }
        } catch (err) {
          if (i === 1) console.error('[CSV] JSON.parse failed on row 1 outputs:', err.message, row[outputsIdx]?.slice(0, 200));
        }
      }

      // 2. Flat column fallback (if outputs parsing didn't yield anything)
      if (!extractedFromOutputs) {
        const bcid = bcidIdx !== -1 ? row[bcidIdx] : null;
        if (!bcid) continue;

        if (floorPtIdx !== -1 && row[floorPtIdx]) {
          const match = row[floorPtIdx].match(/\[\s*([\d.-]+)\s*,\s*([\d.-]+)/);
          if (match) addBody(`b${i}`, bcid, parseFloat(match[1]), parseFloat(match[2]), timestamp);
        }

        if (touchesIdx !== -1 && row[touchesIdx]) {
          const touchMatches = [...row[touchesIdx].matchAll(/floor_pt[^\w{]*\{([^}]+)\}/g)];
          touchMatches.forEach((tm, tIdx) => {
            const xM = tm[1].match(/x\\?["']?\s*:\s*([\d.-]+)/);
            const yM = tm[1].match(/y\\?["']?\s*:\s*([\d.-]+)/);
            if (xM && yM) {
              const tx = parseFloat(xM[1]), ty = parseFloat(yM[1]);
              if (tx > 2 || ty > 2) isNormalized = false;
              touchPoints.push({ id: `t${i}-${tIdx}`, rowIndex: i, bcid, rawX: tx, rawY: ty, timestamp, type: 'touch' });
            }
          });
        }
      }
    }

    console.log('[CSV] parsed body:', bodyPoints.length, 'touches:', touchPoints.length, 'sample:', bodyPoints[0]);
    setScaleCoordinates(isNormalized);
    return { body: bodyPoints, touches: touchPoints };
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target.result);
      const img = new Image();
      img.onload = () => {
        setResolution({ width: img.width, height: img.height });
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const bodyPoints = [];
    const touchPoints = [];
    let isNormalized = true;
    let rowIndex = 0;
    let headers = null;
    let eventTsIdx, outputsIdx, bcidIdx, floorPtIdx, touchesIdx;

    const addBody = (id, bcid, x, y, timestamp) => {
      if (x > 2 || y > 2) isNormalized = false;
      bodyPoints.push({ id, rowIndex: id, bcid, rawX: x, rawY: y, timestamp, type: 'body' });
    };

    setCsvLoading(true);
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      worker: false,
      chunk(results) {
        for (const row of results.data) {
          // First row = headers
          if (headers === null) {
            headers = row.map(h => h.trim().toLowerCase());
            eventTsIdx  = headers.indexOf('event_ts');
            outputsIdx  = headers.indexOf('outputs');
            bcidIdx     = headers.indexOf('bcid');
            floorPtIdx  = headers.indexOf('floor_pt_fused');
            touchesIdx  = headers.indexOf('touches');
            console.log('[CSV] outputsIdx:', outputsIdx, 'bcidIdx:', bcidIdx, 'floorPtIdx:', floorPtIdx);
            continue;
          }

          rowIndex++;
          const tsStr = eventTsIdx !== -1 ? row[eventTsIdx] : null;
          const timestamp = tsStr ? new Date(tsStr).getTime() : rowIndex * 100;

          // Try outputs JSON first (multiple BCIDs per row)
          let extractedFromOutputs = false;
          if (outputsIdx !== -1 && row[outputsIdx]) {
            try {
              const outputs = JSON.parse(row[outputsIdx]);
              if (Array.isArray(outputs)) {
                outputs.forEach((entry, oIdx) => {
                  const bcid = entry.bcid;
                  const fp = entry.floor_pt_fused;
                  if (bcid && Array.isArray(fp) && fp.length >= 2) {
                    addBody(`b${rowIndex}-${oIdx}`, bcid, parseFloat(fp[0]), parseFloat(fp[1]), timestamp);
                    extractedFromOutputs = true;
                  }
                  if (entry.touches && Array.isArray(entry.touches)) {
                    entry.touches.forEach((touch, tIdx) => {
                      const fp2 = touch.floor_pt;
                      if (fp2?.x != null && fp2?.y != null) {
                        const tx = parseFloat(fp2.x), ty = parseFloat(fp2.y);
                        if (tx > 2 || ty > 2) isNormalized = false;
                        touchPoints.push({ id: `t${rowIndex}-${oIdx}-${tIdx}`, rowIndex, bcid, rawX: tx, rawY: ty, timestamp, type: 'touch' });
                      }
                    });
                  }
                });
              }
            } catch (_) { /* fall through to flat columns */ }
          }

          // Flat column fallback
          if (!extractedFromOutputs && bcidIdx !== -1) {
            const bcid = row[bcidIdx];
            if (!bcid) continue;
            if (floorPtIdx !== -1 && row[floorPtIdx]) {
              const match = row[floorPtIdx].match(/\[\s*([\d.-]+)\s*,\s*([\d.-]+)/);
              if (match) addBody(`b${rowIndex}`, bcid, parseFloat(match[1]), parseFloat(match[2]), timestamp);
            }
            if (touchesIdx !== -1 && row[touchesIdx]) {
              const touchMatches = [...row[touchesIdx].matchAll(/floor_pt[^\w{]*\{([^}]+)\}/g)];
              touchMatches.forEach((tm, tIdx) => {
                const xM = tm[1].match(/x\\?["']?\s*:\s*([\d.-]+)/);
                const yM = tm[1].match(/y\\?["']?\s*:\s*([\d.-]+)/);
                if (xM && yM) {
                  const tx = parseFloat(xM[1]), ty = parseFloat(yM[1]);
                  if (tx > 2 || ty > 2) isNormalized = false;
                  touchPoints.push({ id: `t${rowIndex}-${tIdx}`, rowIndex, bcid, rawX: tx, rawY: ty, timestamp, type: 'touch' });
                }
              });
            }
          }
        }
      },
      complete() {
        setCsvLoading(false);
        console.log('[CSV] done — body:', bodyPoints.length, 'touches:', touchPoints.length, 'sample:', bodyPoints[0]);
        if (bodyPoints.length === 0 && touchPoints.length === 0) {
          alert('No tracking data found. Check that the CSV has a valid outputs or bcid column.');
          return;
        }
        const parsedData = { body: bodyPoints, touches: touchPoints };
        const colors = {};
        const allUniqueBcids = [...new Set([...bodyPoints.map(d => d.bcid), ...touchPoints.map(d => d.bcid)])];
        allUniqueBcids.forEach((id, index) => {
          colors[id] = `hsl(${Math.floor((index / allUniqueBcids.length) * 360)}, 75%, 75%)`;
        });
        setScaleCoordinates(isNormalized);
        setBcidColors(colors);
        setCsvData(parsedData);
        setMerges({});
      },
      error(err) {
        setCsvLoading(false);
        alert('Failed to parse CSV: ' + err.message);
      },
    });
  };

  // Analyze CSV endpoints to find connectable paths
  const stitchSuggestions = useMemo(() => {
    if (csvData.body.length === 0) return [];

    // Group body detections by BCID
    const tracks = {};
    csvData.body.forEach(pt => {
      if (!tracks[pt.bcid]) tracks[pt.bcid] = [];
      tracks[pt.bcid].push(pt);
    });

    // Extract sorted bounds for each track
    const bounds = [];
    Object.entries(tracks).forEach(([bcid, pts]) => {
      if (pts.length === 0) return;
      const sorted = [...pts].sort((a, b) => a.timestamp - b.timestamp);
      bounds.push({
        bcid,
        start: sorted[0],
        end: sorted[sorted.length - 1]
      });
    });

    const suggestions = [];
    const maxTimeGapMs = maxTimeGapSec * 1000;
    const maxDistPixels = maxDistPx;

    // Match end of A to start of B
    for (let i = 0; i < bounds.length; i++) {
      const trackA = bounds[i];
      for (let j = 0; j < bounds.length; j++) {
        if (i === j) continue;
        const trackB = bounds[j];

        const timeGap = trackB.start.timestamp - trackA.end.timestamp;
        if (timeGap > 0 && timeGap <= maxTimeGapMs) {
          const ax = scaleCoordinates ? trackA.end.rawX * resolution.width : trackA.end.rawX;
          const ay = scaleCoordinates ? trackA.end.rawY * resolution.height : trackA.end.rawY;
          const bx = scaleCoordinates ? trackB.start.rawX * resolution.width : trackB.start.rawX;
          const by = scaleCoordinates ? trackB.start.rawY * resolution.height : trackB.start.rawY;

          const dist = Math.hypot(bx - ax, by - ay);
          if (dist <= maxDistPixels) {
            suggestions.push({
              id: `${trackA.bcid}-${trackB.bcid}`,
              from: trackA.bcid,
              to: trackB.bcid,
              timeGapMs: timeGap,
              distance: dist,
              fromPt: { x: ax, y: ay },
              toPt: { x: bx, y: by }
            });
          }
        }
      }
    }

    // Sort by proximity score (closer in space + time is ranked higher)
    return suggestions.sort((a, b) => (a.distance + a.timeGapMs / 500) - (b.distance + b.timeGapMs / 500));
  }, [csvData.body, scaleCoordinates, resolution, maxTimeGapSec, maxDistPx]);

  // Helper: resolve pixel coords from a raw point
  const toPixel = (pt) => ({
    x: scaleCoordinates ? pt.rawX * resolution.width : pt.rawX,
    y: scaleCoordinates ? pt.rawY * resolution.height : pt.rawY,
  });

  // Zone id from pixel coords
  const getZoneId = (x, y) => {
    const col = Math.min(Math.floor(x / resolution.width * gridCols), gridCols - 1);
    const row = Math.min(Math.floor(y / resolution.height * gridRows), gridRows - 1);
    return `${col}:${row}`;
  };

  // Dwell segments per BCID
  const dwellSegments = useMemo(() => {
    const result = {};
    const tracks = {};
    csvData.body.forEach(pt => {
      if (!tracks[pt.bcid]) tracks[pt.bcid] = [];
      tracks[pt.bcid].push(pt);
    });

    Object.entries(tracks).forEach(([bcid, pts]) => {
      const sorted = [...pts].sort((a, b) => a.timestamp - b.timestamp).map(p => ({ ...p, ...toPixel(p) }));
      result[bcid] = [];
      let i = 0;
      while (i < sorted.length) {
        const anchor = sorted[i];
        let j = i + 1;
        while (j < sorted.length && Math.hypot(sorted[j].x - anchor.x, sorted[j].y - anchor.y) <= dwellRadiusPx) j++;
        const durationMs = sorted[j - 1].timestamp - anchor.timestamp;
        if (durationMs >= dwellMinSec * 1000 && j - i >= 3) {
          // centroid of dwell cluster
          const cx = sorted.slice(i, j).reduce((s, p) => s + p.x, 0) / (j - i);
          const cy = sorted.slice(i, j).reduce((s, p) => s + p.y, 0) / (j - i);
          result[bcid].push({
            zoneId: getZoneId(cx, cy),
            startTs: anchor.timestamp,
            endTs: sorted[j - 1].timestamp,
            durationMs,
            centroid: { x: cx, y: cy },
            pointCount: j - i,
          });
          i = j;
        } else {
          i++;
        }
      }
    });
    return result;
  }, [csvData.body, scaleCoordinates, resolution, dwellRadiusPx, dwellMinSec, gridCols, gridRows]);

  // Zone transition matrix + zone traffic density
  const { transitionMatrix, zoneDensity } = useMemo(() => {
    const counts = {};
    const fromCounts = {};
    const density = {};

    const tracks = {};
    csvData.body.forEach(pt => {
      if (!tracks[pt.bcid]) tracks[pt.bcid] = [];
      tracks[pt.bcid].push(pt);
    });

    Object.values(tracks).forEach(pts => {
      const sorted = [...pts].sort((a, b) => a.timestamp - b.timestamp);
      let prevZone = null;
      sorted.forEach(pt => {
        const { x, y } = toPixel(pt);
        const zone = getZoneId(x, y);
        density[zone] = (density[zone] || 0) + 1;
        if (prevZone && prevZone !== zone) {
          const key = `${prevZone}->${zone}`;
          counts[key] = (counts[key] || 0) + 1;
          fromCounts[prevZone] = (fromCounts[prevZone] || 0) + 1;
        }
        prevZone = zone;
      });
    });

    const matrix = {};
    Object.entries(counts).forEach(([key, count]) => {
      const [from] = key.split('->');
      matrix[key] = count / (fromCounts[from] || 1);
    });

    return { transitionMatrix: matrix, zoneDensity: density };
  }, [csvData.body, scaleCoordinates, resolution, gridCols, gridRows]);

  // Pattern score per stitch suggestion (0–100)
  const patternScores = useMemo(() => {
    const maxGapMs = maxTimeGapSec * 1000;
    const scores = {};
    stitchSuggestions.forEach(sug => {
      const timeScore = 1 - Math.min(sug.timeGapMs / maxGapMs, 1);
      const distScore = 1 - Math.min(sug.distance / maxDistPx, 1);

      const zoneA = getZoneId(sug.fromPt.x, sug.fromPt.y);
      const zoneB = getZoneId(sug.toPt.x, sug.toPt.y);
      const transProb = zoneA === zoneB ? 1 : (transitionMatrix[`${zoneA}->${zoneB}`] || 0);

      // Dwell bonus: track A ends with a dwell
      const dwellsA = dwellSegments[sug.from] || [];
      const lastDwell = dwellsA[dwellsA.length - 1];
      const dwellBonus = lastDwell && (sug.fromPt ? Math.hypot(lastDwell.centroid.x - sug.fromPt.x, lastDwell.centroid.y - sug.fromPt.y) < dwellRadiusPx * 1.5 : false) ? 1 : 0;

      const raw = (timeScore * 0.3 + distScore * 0.3 + transProb * 0.25 + dwellBonus * 0.15);
      scores[sug.id] = Math.round(raw * 100);
    });
    return scores;
  }, [stitchSuggestions, transitionMatrix, dwellSegments, maxTimeGapSec, maxDistPx, dwellRadiusPx, gridCols, gridRows]);

  // Dynamically calculate stats for the ACTIVE data source taking merges into account
  const bcidStats = useMemo(() => {
    const stats = {};
    activeData.forEach(d => {
      const repBcid = getMergedRepresentative(d.bcid, merges);
      if (!stats[repBcid]) stats[repBcid] = { count: 0, minTs: Infinity, maxTs: -Infinity, mergedChildren: [] };

      stats[repBcid].count += 1;
      if (d.bcid !== repBcid && !stats[repBcid].mergedChildren.includes(d.bcid)) {
        stats[repBcid].mergedChildren.push(d.bcid);
      }

      if (d.timestamp && !isNaN(d.timestamp)) {
        if (d.timestamp < stats[repBcid].minTs) stats[repBcid].minTs = d.timestamp;
        if (d.timestamp > stats[repBcid].maxTs) stats[repBcid].maxTs = d.timestamp;
      }
    });

    Object.keys(stats).forEach(id => {
      const s = stats[id];
      if (s.minTs !== Infinity && s.maxTs !== -Infinity) {
        const diffSec = Math.max(0, Math.round((s.maxTs - s.minTs) / 1000));
        const mins = Math.floor(diffSec / 60);
        const secs = diffSec % 60;
        s.durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        s.startStr = new Date(s.minTs).toLocaleTimeString();
        s.endStr = new Date(s.maxTs).toLocaleTimeString();
      } else {
        s.durationStr = 'N/A';
        s.startStr = 'N/A';
        s.endStr = 'N/A';
      }
    });

    return stats;
  }, [activeData, merges]);

  // Animation RAF loop
  useEffect(() => {
    if (!isAnimating) {
      cancelAnimationFrame(animRafRef.current);
      animLastTimeRef.current = null;
      return;
    }
    const totalWallMs = 20000 / animSpeed; // full journey = 20s at 1×
    const tick = (now) => {
      if (animLastTimeRef.current === null) animLastTimeRef.current = now;
      const elapsed = now - animLastTimeRef.current;
      animLastTimeRef.current = now;
      const delta = elapsed / totalWallMs;
      setAnimProgress(prev => {
        const next = prev + delta;
        if (next >= 1) {
          setIsAnimating(false);
          return 1;
        }
        return next;
      });
      animRafRef.current = requestAnimationFrame(tick);
    };
    animRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRafRef.current);
  }, [isAnimating, animSpeed]);

  const processData = () => {
    if (!imageSrc || (csvData.body.length === 0 && csvData.touches.length === 0)) {
      alert("Please upload both the floor plan image and the CSV data.");
      return;
    }
    setAppState('map');
  };

  const displayData = useMemo(() => {
    return activeData.map(d => ({
      ...d,
      x: scaleCoordinates ? d.rawX * resolution.width : d.rawX,
      y: scaleCoordinates ? d.rawY * resolution.height : d.rawY
    }));
  }, [activeData, scaleCoordinates, resolution]);

  // Global time range across all active display data (must come after displayData)
  const timeRange = useMemo(() => {
    const timestamps = displayData.map(d => d.timestamp).filter(t => t && !isNaN(t));
    if (timestamps.length === 0) return null;
    return { min: Math.min(...timestamps), max: Math.max(...timestamps) };
  }, [displayData]);

  // Handle manual stitch action
  const handleStitch = (from, to) => {
    setMerges(prev => {
      const next = { ...prev };
      const repFrom = getMergedRepresentative(from, next);
      const repTo = getMergedRepresentative(to, next);
      if (repFrom !== repTo) {
        next[repTo] = repFrom;
      }
      return next;
    });
  };

  // Reset all merged paths
  const handleResetMerges = () => {
    setMerges({});
  };

  // Render Canvas
  useEffect(() => {
    if (appState !== 'map' || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 0. Zone overlay
    if (showZoneOverlay && Object.keys(zoneDensity).length > 0) {
      const maxDensity = Math.max(...Object.values(zoneDensity));
      const cellW = canvas.width / gridCols;
      const cellH = canvas.height / gridRows;
      for (let c = 0; c < gridCols; c++) {
        for (let r = 0; r < gridRows; r++) {
          const zid = `${c}:${r}`;
          const d = zoneDensity[zid] || 0;
          const alpha = d > 0 ? 0.1 + (d / maxDensity) * 0.45 : 0;
          ctx.fillStyle = `rgba(99, 102, 241, ${alpha})`;
          ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c * cellW, r * cellH, cellW, cellH);
          if (d > 0) {
            ctx.fillStyle = 'rgba(30,30,80,0.55)';
            ctx.font = `${Math.max(9, Math.min(cellW, cellH) * 0.22)}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(d, c * cellW + cellW / 2, r * cellH + cellH / 2);
          }
        }
      }
    }

    // 1. If hovering over a suggested connection, draw a bright interactive link
    if (hoveredSuggestion) {
      const { fromPt, toPt } = hoveredSuggestion;
      ctx.beginPath();
      ctx.moveTo(fromPt.x, fromPt.y);
      ctx.lineTo(toPt.x, toPt.y);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 4;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Pulse animation marker
      ctx.beginPath();
      ctx.arc(fromPt.x, fromPt.y, 10, 0, 2 * Math.PI);
      ctx.arc(toPt.x, toPt.y, 10, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.3)';
      ctx.fill();
    }

    // 2. Group active data by ultimate merged parent BCID
    const groupedData = {};
    displayData.forEach(point => {
      const repBcid = getMergedRepresentative(point.bcid, merges);
      if (!groupedData[repBcid]) groupedData[repBcid] = [];
      groupedData[repBcid].push(point);
    });

    // BCIDs hidden via pair toggles
    const pairHiddenBcids = new Set();
    stitchSuggestions.forEach(sug => {
      if (hiddenPairs.has(sug.id)) {
        pairHiddenBcids.add(getMergedRepresentative(sug.from, merges));
        pairHiddenBcids.add(getMergedRepresentative(sug.to, merges));
      }
    });

    // Compute animation time cursor
    const isAnimMode = animProgress > 0 && animProgress <= 1 && timeRange;
    const currentMaxTs = isAnimMode
      ? timeRange.min + animProgress * (timeRange.max - timeRange.min)
      : null;

    // 3. Render the paths
    Object.entries(groupedData).forEach(([repBcid, points]) => {
      if (hiddenBcids.has(repBcid)) return;
      if (pairHiddenBcids.has(repBcid)) return;
      if (searchQuery && !repBcid.toLowerCase().includes(searchQuery.toLowerCase())) return;

      const color = bcidColors[repBcid] || '#ccc';

      // In animation mode, only show points up to currentMaxTs
      // Also filter by selected zones if any are active
      const visiblePoints = points.filter(p => {
        if (currentMaxTs && p.timestamp > currentMaxTs) return false;
        if (selectedZones.size > 0 && !selectedZones.has(getZoneId(p.x, p.y))) return false;
        return true;
      });

      if (visiblePoints.length === 0) return;

      if (renderMode === 'dots') {
        visiblePoints.forEach(point => {
          const isTouch = point.type === 'touch';

          ctx.beginPath();
          ctx.arc(point.x, point.y, isTouch ? 9 : 4, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.stroke();

          if (isTouch) {
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🖐️', point.x, point.y);
          }
        });
      } else {
        // Sort entire merged group chronologically to connect them smoothly
        const sortedPoints = [...visiblePoints].sort((a, b) => {
          if (a.timestamp && b.timestamp) return a.timestamp - b.timestamp;
          return a.rowIndex - b.rowIndex;
        });

        if (sortedPoints.length === 0) return;

        ctx.beginPath();
        ctx.moveTo(sortedPoints[0].x, sortedPoints[0].y);
        for(let i = 1; i < sortedPoints.length; i++) {
          ctx.lineTo(sortedPoints[i].x, sortedPoints[i].y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        if (renderMode === 'arrows') {
          let accumulatedDist = 0;
          for(let i = 0; i < sortedPoints.length - 1; i++) {
            const p1 = sortedPoints[i];
            const p2 = sortedPoints[i+1];
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            accumulatedDist += dist;

            if (accumulatedDist > 60 || i === sortedPoints.length - 2) {
              const angle = Math.atan2(dy, dx);
              ctx.save();
              ctx.beginPath();
              ctx.translate(p2.x, p2.y);
              ctx.rotate(angle);
              ctx.moveTo(2, 0);
              ctx.lineTo(-10, -6);
              ctx.lineTo(-10, 6);
              ctx.closePath();
              ctx.fillStyle = '#333';
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = color;
              ctx.stroke();
              ctx.restore();
              accumulatedDist = 0;
            }
          }
        }

        // Embellish touch points
        sortedPoints.forEach(point => {
          if (point.type === 'touch') {
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🖐️', point.x, point.y);
          }
        });

        // Embellish start/end points
        if (sortedPoints.length > 1 && dataSource !== 'touches') {
          const startPt = sortedPoints[0];
          const endPt = sortedPoints[sortedPoints.length - 1];

          ctx.beginPath();
          ctx.arc(startPt.x, startPt.y, 5, 0, 2*Math.PI);
          ctx.fillStyle = '#10b981';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#fff';
          ctx.stroke();

          if (!isAnimMode) {
            ctx.beginPath();
            ctx.arc(endPt.x, endPt.y, 5, 0, 2*Math.PI);
            ctx.fillStyle = '#ef4444';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
          }
        }
      }

      // Animated head: glowing dot at the leading edge
      if (isAnimMode && visiblePoints.length > 0) {
        const sorted = [...visiblePoints].sort((a, b) => a.timestamp - b.timestamp);
        const head = sorted[sorted.length - 1];
        // outer glow
        const gradient = ctx.createRadialGradient(head.x, head.y, 4, head.x, head.y, 18);
        gradient.addColorStop(0, color.replace('hsl(', 'hsla(').replace(')', ', 0.5)'));
        gradient.addColorStop(1, color.replace('hsl(', 'hsla(').replace(')', ', 0)'));
        ctx.beginPath();
        ctx.arc(head.x, head.y, 18, 0, 2 * Math.PI);
        ctx.fillStyle = gradient;
        ctx.fill();
        // solid head
        ctx.beginPath();
        ctx.arc(head.x, head.y, 7, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
    });
  }, [appState, displayData, hiddenBcids, hiddenPairs, bcidColors, searchQuery, renderMode, dataSource, merges, hoveredSuggestion, stitchSuggestions, showZoneOverlay, zoneDensity, gridCols, gridRows, animProgress, timeRange, selectedZones]);

  // Handle Mouse Hover for Tooltips
  const handleMouseMove = (e) => {
    if (!canvasRef.current || !containerRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;

    let closest = null;
    let minDist = 12; // Interaction radius

    for (let i = 0; i < displayData.length; i++) {
      const p = displayData[i];
      const repBcid = getMergedRepresentative(p.bcid, merges);
      if (hiddenBcids.has(repBcid)) continue;

      const dist = Math.sqrt(Math.pow(p.x - mouseX, 2) + Math.pow(p.y - mouseY, 2));
      if (dist < minDist) {
        minDist = dist;
        closest = p;
      }
    }

    if (closest) {
      setHoveredPoint({
        ...closest,
        cssX: (closest.x / resolution.width) * 100,
        cssY: (closest.y / resolution.height) * 100
      });
    } else {
      setHoveredPoint(null);
    }
  };

  const toggleBcidVisibility = (bcid) => {
    setHiddenBcids(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bcid)) newSet.delete(bcid);
      else newSet.add(bcid);
      return newSet;
    });
  };

  const toggleAllBcids = () => {
    if (hiddenBcids.size > 0) {
      setHiddenBcids(new Set());
    } else {
      const allActiveBcids = new Set(Object.keys(bcidStats));
      setHiddenBcids(allActiveBcids);
    }
  };

  if (appState === 'setup') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-xl p-8 border border-slate-100">

          <div className="text-center mb-8">
            <div className="bg-indigo-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <MapIcon className="text-indigo-600 w-8 h-8" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800">Floor Plan Data Mapper</h1>
            <p className="text-slate-500 mt-2">Upload your floor plan and coordinate data to visualize tracking points.</p>
          </div>

          <div className="space-y-6">
            <div className={`border-2 border-dashed rounded-xl p-6 transition-colors ${imageSrc ? 'border-green-400 bg-green-50' : 'border-slate-300 hover:border-indigo-400 bg-slate-50'}`}>
              <label className="flex flex-col items-center cursor-pointer">
                {imageSrc ? <CheckCircle2 className="text-green-500 w-10 h-10 mb-2" /> : <Upload className="text-slate-400 w-10 h-10 mb-2" />}
                <span className="text-sm font-medium text-slate-700">
                  {imageSrc ? 'Floor Plan Loaded Successfully' : '1. Upload Floor Plan Image'}
                </span>
                <span className="text-xs text-slate-500 mt-1">Accepts JPG, PNG</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
            </div>

            <div className={`border-2 border-dashed rounded-xl p-6 transition-colors ${(csvData.body.length > 0 || csvData.touches.length > 0) ? 'border-green-400 bg-green-50' : csvLoading ? 'border-indigo-300 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 bg-slate-50'}`}>
              <label className="flex flex-col items-center cursor-pointer">
                {csvLoading
                  ? <div className="w-10 h-10 mb-2 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
                  : (csvData.body.length > 0 || csvData.touches.length > 0)
                    ? <CheckCircle2 className="text-green-500 w-10 h-10 mb-2" />
                    : <Upload className="text-slate-400 w-10 h-10 mb-2" />}
                <span className="text-sm font-medium text-slate-700">
                  {csvLoading
                    ? 'Parsing CSV… (large files may take a moment)'
                    : (csvData.body.length > 0 || csvData.touches.length > 0)
                      ? `CSV Loaded: ${csvData.body.length} bodies, ${csvData.touches.length} touches`
                      : '2. Upload Tracking Data (CSV)'}
                </span>
                <span className="text-xs text-slate-500 mt-1">Must contain 'bcid', 'floor_pt_fused', and optionally 'touches'</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} disabled={csvLoading} />
              </label>
            </div>

            <button
              onClick={processData}
              disabled={!imageSrc || (csvData.body.length === 0 && csvData.touches.length === 0)}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold rounded-xl transition-colors shadow-sm disabled:cursor-not-allowed"
            >
              Generate Map
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-100 font-sans">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <MapIcon className="text-indigo-600 w-6 h-6" />
          <h1 className="text-xl font-bold text-slate-800 hidden sm:block">Floor Plan View</h1>
        </div>
        <div className="flex items-center gap-4 text-sm flex-wrap">

          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">Data:</span>
            <select
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-700 font-medium rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow cursor-pointer"
            >
              <option value="body">👤 Body Detections</option>
              <option value="touches">🖐️ Touch Points</option>
              <option value="combined">🔗 Combined View</option>
            </select>
          </div>

          <div className="h-6 border-l border-slate-300 mx-1 hidden sm:block"></div>

          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">View As:</span>
            <select
              value={renderMode}
              onChange={(e) => setRenderMode(e.target.value)}
              className="bg-slate-50 border border-slate-200 text-slate-700 font-medium rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow cursor-pointer"
            >
              <option value="dots">Dots</option>
              <option value="trail">Trail Lines</option>
              <option value="arrows">Direction Arrows</option>
            </select>
          </div>

          <div className="h-6 border-l border-slate-300 mx-1 hidden sm:block"></div>

          <div className="flex items-center gap-2">
            <span className="text-slate-600 font-medium">Scale</span>
            <button
              onClick={() => setScaleCoordinates(!scaleCoordinates)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${scaleCoordinates ? 'bg-indigo-600' : 'bg-slate-300'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${scaleCoordinates ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          <button
            onClick={() => { setAppState('setup'); setSelectedZones(new Set()); }}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors font-medium ml-2"
          >
            Start Over
          </button>

          <div className="h-6 border-l border-slate-300 mx-1 hidden sm:block"></div>

          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 bg-slate-50 hover:bg-slate-200 text-slate-600 border border-slate-200 rounded-lg transition-colors ml-1"
            title="Toggle Data Overview Sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">

        {/* Journey Animation Controls */}
        {appState === 'map' && timeRange && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 w-[min(560px,80%)]">
            {/* Scrubber + timestamp */}
            <div className="w-full flex items-center gap-2 bg-white/90 backdrop-blur rounded-xl px-4 py-2 shadow-lg border border-slate-200">
              <span className="text-[10px] font-mono text-slate-400 shrink-0 w-16 text-right">
                {timeRange ? new Date(timeRange.min + animProgress * (timeRange.max - timeRange.min)).toLocaleTimeString() : '--:--'}
              </span>
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round(animProgress * 1000)}
                onChange={e => {
                  setIsAnimating(false);
                  setAnimProgress(Number(e.target.value) / 1000);
                }}
                className="flex-1 h-1.5 accent-indigo-600 cursor-pointer"
              />
              <span className="text-[10px] font-mono text-slate-400 shrink-0 w-16">
                {timeRange ? new Date(timeRange.max).toLocaleTimeString() : '--:--'}
              </span>
            </div>
            {/* Play controls */}
            <div className="flex items-center gap-2 bg-white/90 backdrop-blur rounded-xl px-4 py-2 shadow-lg border border-slate-200">
              <button
                onClick={() => { setAnimProgress(0); setIsAnimating(false); animLastTimeRef.current = null; }}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
                title="Reset"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (animProgress >= 1) { setAnimProgress(0); animLastTimeRef.current = null; }
                  setIsAnimating(v => !v);
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
              >
                {isAnimating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {isAnimating ? 'Pause' : animProgress > 0 && animProgress < 1 ? 'Resume' : 'Play Journey'}
              </button>
              <div className="h-5 border-l border-slate-200 mx-1" />
              <span className="text-[11px] text-slate-500 font-medium">Speed:</span>
              {[1, 2, 5, 10].map(s => (
                <button
                  key={s}
                  onClick={() => setAnimSpeed(s)}
                  className={`px-2 py-1 text-[11px] font-bold rounded transition-colors border ${animSpeed === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-400'}`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Floating Zoom Controls */}
        <div className="absolute bottom-6 left-6 flex flex-col bg-white rounded-lg shadow-md border border-slate-200 overflow-hidden z-20">
          <button
            onClick={() => setZoomLevel(prev => Math.min(prev + 25, 500))}
            className="p-2 hover:bg-slate-100 text-slate-700 transition-colors border-b border-slate-200"
            title="Zoom In"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <div
            className="px-2 py-1.5 text-xs font-bold text-slate-600 text-center border-b border-slate-200 bg-slate-50 cursor-pointer hover:bg-slate-100"
            onClick={() => setZoomLevel(100)}
            title="Reset Zoom"
          >
            {zoomLevel}%
          </div>
          <button
            onClick={() => setZoomLevel(prev => Math.max(prev - 25, 25))}
            className="p-2 hover:bg-slate-100 text-slate-700 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
        </div>

        <div className={`flex-1 overflow-auto p-6 bg-slate-200/50 flex ${zoomLevel <= 100 ? 'justify-center items-start' : 'items-start'}`}>
          <div
            ref={containerRef}
            className="relative shadow-2xl bg-white border border-slate-300 shrink-0"
            style={{
              aspectRatio: `${resolution.width} / ${resolution.height}`,
              width: `${zoomLevel}%`,
              height: 'auto'
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredPoint(null)}
          >
            <img
              src={imageSrc}
              alt="Floor Plan"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            />

            <canvas
              ref={canvasRef}
              width={resolution.width}
              height={resolution.height}
              className="absolute inset-0 w-full h-full z-10 cursor-crosshair"
            />

            {hoveredPoint && (
              <div
                className="absolute z-20 pointer-events-none transform -translate-x-1/2 -translate-y-full pb-3"
                style={{ left: `${hoveredPoint.cssX}%`, top: `${hoveredPoint.cssY}%` }}
              >
                <div className="bg-slate-800 text-white text-xs px-3 py-2 rounded shadow-lg whitespace-nowrap">
                  <div className="font-bold flex items-center gap-2 mb-1">
                    <span
                      className="w-3 h-3 rounded-full inline-block border border-white/20"
                      style={{ backgroundColor: bcidColors[getMergedRepresentative(hoveredPoint.bcid, merges)] }}
                    />
                    ID: {getMergedRepresentative(hoveredPoint.bcid, merges)}
                    {hoveredPoint.bcid !== getMergedRepresentative(hoveredPoint.bcid, merges) && (
                      <span className="text-[10px] text-slate-400 ml-1">({hoveredPoint.bcid})</span>
                    )}
                  </div>
                  <div className="text-slate-300 font-mono">
                    x: {Math.round(hoveredPoint.x)}, y: {Math.round(hoveredPoint.y)}
                  </div>
                  <div className="text-slate-400 mt-1">
                    {hoveredPoint.type === 'touch' ? '🖐️ Touch Point' : '👤 Body Detection'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {isSidebarOpen && (
          <aside className="w-80 shrink-0 bg-white border-l border-slate-200 flex flex-col shadow-sm z-10">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Settings className="w-5 h-5" /> Data Overview
              </h2>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-slate-500">Current Points:</span>
                <span className="font-bold text-slate-800">{activeData.length}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-sm">
                <span className="text-slate-500">Active Paths:</span>
                <span className="font-bold text-slate-800">{Object.keys(bcidStats).length}</span>
              </div>

              {/* Reset merges button if any are present */}
              {Object.keys(merges).length > 0 && (
                <button
                  onClick={handleResetMerges}
                  className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors font-semibold"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reset Path Merges ({Object.keys(merges).length})
                </button>
              )}
            </div>

            {/* Sidebar Sub-Tabs selector */}
            <div className="flex border-b border-slate-100 bg-slate-50/50 p-1">
              <button
                onClick={() => setSidebarTab('legend')}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${sidebarTab === 'legend' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
              >
                Legend
              </button>
              <button
                onClick={() => setSidebarTab('stitcher')}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${sidebarTab === 'stitcher' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <GitCommit className="w-3.5 h-3.5" /> Stitch Finder
                {stitchSuggestions.length > 0 && (
                  <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none font-extrabold scale-90">
                    {stitchSuggestions.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setSidebarTab('pattern')}
                className={`flex-1 py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${sidebarTab === 'pattern' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-800'}`}
              >
                <Search className="w-3.5 h-3.5" /> Pattern
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto">
              {sidebarTab === 'legend' ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Paths</h3>
                    <button
                      onClick={toggleAllBcids}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      {hiddenBcids.size === 0 ? 'Hide All' : 'Show All'}
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="text-[11px] text-slate-400 shrink-0">Sort:</span>
                    {[
                      { key: 'points-desc', label: 'Most Points' },
                      { key: 'points-asc',  label: 'Least Points' },
                      { key: 'duration-desc', label: 'Longest' },
                      { key: 'duration-asc',  label: 'Shortest' },
                    ].map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setLegendSort(opt.key)}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors font-medium ${legendSort === opt.key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-400'}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  <div className="mb-4 relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search active IDs..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-shadow"
                    />
                  </div>

                  <div className="space-y-2">
                    {Object.entries(bcidStats)
                      .filter(([bcid]) => !searchQuery || bcid.toLowerCase().includes(searchQuery.toLowerCase()))
                      .sort(([, a], [, b]) => {
                        const durA = a.maxTs - a.minTs || 0;
                        const durB = b.maxTs - b.minTs || 0;
                        if (legendSort === 'points-desc') return b.count - a.count;
                        if (legendSort === 'points-asc')  return a.count - b.count;
                        if (legendSort === 'duration-desc') return durB - durA;
                        if (legendSort === 'duration-asc')  return durA - durB;
                        return 0;
                      })
                      .map(([bcid, stats]) => {
                      const color = bcidColors[bcid];
                      const isHidden = hiddenBcids.has(bcid);

                      return (
                        <div
                          key={bcid}
                          onClick={() => toggleBcidVisibility(bcid)}
                          className={`flex flex-col p-2.5 rounded-lg cursor-pointer transition-colors border ${isHidden ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200 shadow-sm hover:border-indigo-300'}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 overflow-hidden">
                              <div
                                className="w-4 h-4 rounded-full shadow-inner flex-shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className={`text-sm font-semibold ${isHidden ? 'line-through text-slate-400' : 'text-slate-700'} truncate max-w-[120px]`} title={bcid}>
                                {bcid}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                                {stats.count} pt • {stats.durationStr}
                              </span>
                              {isHidden ? <EyeOff className="w-4 h-4 text-slate-400" /> : <Eye className="w-4 h-4 text-slate-600" />}
                            </div>
                          </div>
                          <div className="mt-1.5 pl-7 flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                            <span>{stats.startStr}</span>
                            <span className="text-slate-300">→</span>
                            <span>{stats.endStr}</span>
                          </div>
                          {stats.mergedChildren.length > 0 && (
                            <div className="mt-1 pl-7 text-[10px] text-slate-400 font-medium">
                              Stitched with: {stats.mergedChildren.join(', ')}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {Object.keys(bcidStats).length === 0 && (
                      <div className="text-center py-6 text-sm text-slate-400">
                        No tracking data available for this source.
                      </div>
                    )}
                  </div>
                </>
              ) : sidebarTab === 'stitcher' ? (
                <>
                  <div className="mb-3 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-slate-600 space-y-1.5">
                    <div className="font-bold text-indigo-800 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-indigo-600" /> Chronological Stitch Finder
                    </div>
                    <p className="leading-relaxed">
                      Scans coordinates and event timestamps to identify separate track segments that ended and started close in time and space.
                    </p>
                  </div>

                  {/* Configurable thresholds */}
                  <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Thresholds</div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600 w-28 shrink-0">Max Time Gap</label>
                      <input
                        type="number"
                        min={1}
                        max={300}
                        value={maxTimeGapSec}
                        onChange={e => setMaxTimeGapSec(Math.max(1, Number(e.target.value)))}
                        className="w-16 px-2 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      />
                      <span className="text-xs text-slate-400">seconds</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600 w-28 shrink-0">Max Distance</label>
                      <input
                        type="number"
                        min={1}
                        max={2000}
                        value={maxDistPx}
                        onChange={e => setMaxDistPx(Math.max(1, Number(e.target.value)))}
                        className="w-16 px-2 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                      />
                      <span className="text-xs text-slate-400">pixels</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {stitchSuggestions.map((sug) => {
                      const isAlreadyStitched = getMergedRepresentative(sug.to, merges) === getMergedRepresentative(sug.from, merges);
                      const isExpanded = expandedSuggestion === sug.id;
                      const isPairHidden = hiddenPairs.has(sug.id);

                      // Gather per-track stats for detail view
                      const trackAPoints = csvData.body.filter(p => p.bcid === sug.from).sort((a,b) => a.timestamp - b.timestamp);
                      const trackBPoints = csvData.body.filter(p => p.bcid === sug.to).sort((a,b) => a.timestamp - b.timestamp);
                      const fmtTs = (ts) => ts ? new Date(ts).toLocaleTimeString() : '—';

                      return (
                        <div
                          key={sug.id}
                          onMouseEnter={() => setHoveredSuggestion(sug)}
                          onMouseLeave={() => setHoveredSuggestion(null)}
                          className={`border rounded-lg transition-all flex flex-col bg-white ${isPairHidden ? 'opacity-50' : ''} ${isAlreadyStitched ? 'border-green-200 bg-green-50/20' : 'border-slate-200 hover:border-indigo-300 hover:shadow-sm'}`}
                        >
                          {/* Card header */}
                          <div className="p-3 flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <div className="flex flex-col max-w-[45%]">
                                <span className="text-xs font-bold text-slate-700 truncate" title={sug.from}>{sug.from}</span>
                                <span className="text-[10px] text-slate-400 font-medium">ended</span>
                              </div>
                              <span className="text-slate-400 text-xs font-bold">➡️</span>
                              <div className="flex flex-col max-w-[45%] text-right">
                                <span className="text-xs font-bold text-slate-700 truncate" title={sug.to}>{sug.to}</span>
                                <span className="text-[10px] text-slate-400 font-medium">started</span>
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                              <span>Gap: <strong>{Math.round(sug.timeGapMs / 100) / 10}s</strong></span>
                              <span>Distance: <strong>{Math.round(sug.distance)}px</strong></span>
                            </div>

                            {/* Actions row */}
                            <div className="flex items-center gap-2">
                              {isAlreadyStitched ? (
                                <div className="flex-1 text-center py-1.5 text-xs text-green-700 font-bold bg-green-100/60 rounded border border-green-200">
                                  ✓ Tracks Stitched
                                </div>
                              ) : (
                                <button
                                  onClick={() => handleStitch(sug.from, sug.to)}
                                  className="flex-1 py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 font-bold rounded transition-colors"
                                >
                                  Stitch Tracks
                                </button>
                              )}
                              {/* Hide/show toggle */}
                              <button
                                onClick={() => setHiddenPairs(prev => {
                                  const next = new Set(prev);
                                  if (next.has(sug.id)) next.delete(sug.id);
                                  else next.add(sug.id);
                                  return next;
                                })}
                                className="p-1.5 border border-slate-200 rounded hover:bg-slate-100 transition-colors"
                                title={isPairHidden ? 'Show pair on map' : 'Hide pair on map'}
                              >
                                {isPairHidden ? <EyeOff className="w-3.5 h-3.5 text-slate-400" /> : <Eye className="w-3.5 h-3.5 text-slate-600" />}
                              </button>
                              {/* Expand detail toggle */}
                              <button
                                onClick={() => setExpandedSuggestion(isExpanded ? null : sug.id)}
                                className="p-1.5 border border-slate-200 rounded hover:bg-slate-100 transition-colors"
                                title="View pair details"
                              >
                                <Info className="w-3.5 h-3.5 text-slate-500" />
                              </button>
                            </div>
                          </div>

                          {/* Expanded detail view */}
                          {isExpanded && (
                            <div className="border-t border-slate-100 bg-slate-50 rounded-b-lg p-3 space-y-3 text-[11px]">
                              {[
                                { label: 'Track A (ended)', bcid: sug.from, pts: trackAPoints, endPt: sug.fromPt },
                                { label: 'Track B (started)', bcid: sug.to, pts: trackBPoints, startPt: sug.toPt },
                              ].map(({ label, bcid, pts, endPt, startPt }) => (
                                <div key={bcid} className="bg-white border border-slate-200 rounded-md p-2.5 space-y-1">
                                  <div className="font-bold text-slate-600 mb-1">{label}</div>
                                  <div className="flex justify-between text-slate-500">
                                    <span>ID</span>
                                    <span className="font-mono text-slate-700 truncate max-w-[60%] text-right" title={bcid}>{bcid}</span>
                                  </div>
                                  <div className="flex justify-between text-slate-500">
                                    <span>Points</span>
                                    <span className="font-semibold text-slate-700">{pts.length}</span>
                                  </div>
                                  <div className="flex justify-between text-slate-500">
                                    <span>First seen</span>
                                    <span className="text-slate-700">{fmtTs(pts[0]?.timestamp)}</span>
                                  </div>
                                  <div className="flex justify-between text-slate-500">
                                    <span>Last seen</span>
                                    <span className="text-slate-700">{fmtTs(pts[pts.length - 1]?.timestamp)}</span>
                                  </div>
                                  {endPt && (
                                    <div className="flex justify-between text-slate-500">
                                      <span>End coords</span>
                                      <span className="font-mono text-slate-700">{Math.round(endPt.x)}, {Math.round(endPt.y)}</span>
                                    </div>
                                  )}
                                  {startPt && (
                                    <div className="flex justify-between text-slate-500">
                                      <span>Start coords</span>
                                      <span className="font-mono text-slate-700">{Math.round(startPt.x)}, {Math.round(startPt.y)}</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                              <div className="bg-white border border-indigo-100 rounded-md p-2.5 space-y-1">
                                <div className="font-bold text-indigo-600 mb-1">Gap Summary</div>
                                <div className="flex justify-between text-slate-500">
                                  <span>Time gap</span>
                                  <span className="font-semibold text-slate-700">{Math.round(sug.timeGapMs / 100) / 10}s</span>
                                </div>
                                <div className="flex justify-between text-slate-500">
                                  <span>Spatial distance</span>
                                  <span className="font-semibold text-slate-700">{Math.round(sug.distance)}px</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {stitchSuggestions.length === 0 && (
                      <div className="text-center py-8 text-sm text-slate-400">
                        <HelpCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        No stitchable track pairs detected within {maxTimeGapSec}s and {maxDistPx}px.
                      </div>
                    )}
                  </div>
                </>
              ) : sidebarTab === 'pattern' ? (
                <>
                  {/* Zone Filter */}
                  <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Filter by Zone</div>
                      {selectedZones.size > 0 && (
                        <button
                          onClick={() => setSelectedZones(new Set())}
                          className="text-[10px] text-indigo-600 hover:text-indigo-800 font-semibold"
                        >
                          Show All
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 leading-snug">
                      Click zones to filter detections. Multi-select supported.
                    </p>
                    {/* Zone picker grid */}
                    <div
                      className="w-full border border-slate-200 rounded overflow-hidden"
                      style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, 1fr)`, aspectRatio: `${resolution.width} / ${resolution.height}` }}
                    >
                      {Array.from({ length: gridRows }, (_, r) =>
                        Array.from({ length: gridCols }, (_, c) => {
                          const zid = `${c}:${r}`;
                          const count = zoneDensity[zid] || 0;
                          const maxD = Math.max(1, ...Object.values(zoneDensity));
                          const intensity = count / maxD;
                          const isSelected = selectedZones.has(zid);
                          return (
                            <button
                              key={zid}
                              onClick={() => setSelectedZones(prev => {
                                const next = new Set(prev);
                                if (next.has(zid)) next.delete(zid);
                                else next.add(zid);
                                return next;
                              })}
                              title={`Zone ${zid}: ${count} detections`}
                              style={{
                                backgroundColor: isSelected
                                  ? `rgba(99,102,241,${0.3 + intensity * 0.55})`
                                  : count > 0
                                    ? `rgba(99,102,241,${0.08 + intensity * 0.25})`
                                    : 'rgba(226,232,240,0.4)',
                              }}
                              className={`relative border border-slate-200/60 transition-all text-[8px] font-bold flex items-center justify-center
                                ${isSelected ? 'ring-2 ring-inset ring-indigo-500 text-indigo-900' : count > 0 ? 'text-slate-500 hover:ring-1 hover:ring-indigo-400' : 'text-slate-300 hover:ring-1 hover:ring-slate-300'}`}
                            >
                              {count > 0 ? count : ''}
                              {isSelected && (
                                <span className="absolute inset-0 flex items-center justify-center text-indigo-700 text-[9px] font-extrabold">✓</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                    {selectedZones.size > 0 && (
                      <div className="text-[10px] text-indigo-600 font-semibold">
                        {selectedZones.size} zone{selectedZones.size > 1 ? 's' : ''} selected — showing filtered detections
                      </div>
                    )}
                  </div>

                  {/* Zone & Dwell config */}
                  <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Zone Grid</div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600 w-28 shrink-0">Columns</label>
                      <input type="number" min={1} max={20} value={gridCols} onChange={e => setGridCols(Math.max(1, Number(e.target.value)))}
                        className="w-14 px-2 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600 w-28 shrink-0">Rows</label>
                      <input type="number" min={1} max={20} value={gridRows} onChange={e => setGridRows(Math.max(1, Number(e.target.value)))}
                        className="w-14 px-2 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
                    </div>
                    <button
                      onClick={() => setShowZoneOverlay(v => !v)}
                      className={`w-full py-1.5 text-xs font-bold rounded border transition-colors ${showZoneOverlay ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-400'}`}
                    >
                      {showZoneOverlay ? '🟣 Hide Zone Heatmap' : '🔲 Show Zone Heatmap'}
                    </button>
                  </div>

                  <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Dwell Detection</div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600 w-28 shrink-0">Radius</label>
                      <input type="number" min={5} max={500} value={dwellRadiusPx} onChange={e => setDwellRadiusPx(Math.max(5, Number(e.target.value)))}
                        className="w-14 px-2 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
                      <span className="text-xs text-slate-400">px</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600 w-28 shrink-0">Min Duration</label>
                      <input type="number" min={1} max={300} value={dwellMinSec} onChange={e => setDwellMinSec(Math.max(1, Number(e.target.value)))}
                        className="w-14 px-2 py-1 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
                      <span className="text-xs text-slate-400">sec</span>
                    </div>
                  </div>

                  {/* Pattern-scored stitch pairs */}
                  <div className="mb-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Stitch Pairs — Pattern Score</div>
                  <div className="space-y-2">
                    {[...stitchSuggestions]
                      .sort((a, b) => (patternScores[b.id] || 0) - (patternScores[a.id] || 0))
                      .map(sug => {
                        const score = patternScores[sug.id] ?? 0;
                        const zoneA = getZoneId(sug.fromPt.x, sug.fromPt.y);
                        const zoneB = getZoneId(sug.toPt.x, sug.toPt.y);
                        const transProb = zoneA === zoneB ? 1 : (transitionMatrix[`${zoneA}->${zoneB}`] || 0);
                        const dwellsA = dwellSegments[sug.from] || [];
                        const lastDwell = dwellsA[dwellsA.length - 1];
                        const hasDwell = lastDwell && Math.hypot(lastDwell.centroid.x - sug.fromPt.x, lastDwell.centroid.y - sug.fromPt.y) < dwellRadiusPx * 1.5;
                        const scoreColor = score >= 70 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
                          : score >= 40 ? 'text-amber-600 bg-amber-50 border-amber-200'
                          : 'text-slate-500 bg-slate-50 border-slate-200';

                        return (
                          <div key={sug.id} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-bold text-slate-700 truncate max-w-[60%]" title={`${sug.from} → ${sug.to}`}>
                                {sug.from} <span className="text-slate-400 font-normal">→</span> {sug.to}
                              </div>
                              <span className={`text-xs font-extrabold px-2 py-0.5 rounded border ${scoreColor}`}>
                                {score}%
                              </span>
                            </div>

                            {/* Signal breakdown */}
                            <div className="space-y-1.5 text-[11px]">
                              {[
                                { label: 'Time Gap', value: `${Math.round(sug.timeGapMs / 100) / 10}s`, score: Math.round((1 - sug.timeGapMs / (maxTimeGapSec * 1000)) * 100) },
                                { label: 'Distance', value: `${Math.round(sug.distance)}px`, score: Math.round((1 - sug.distance / maxDistPx) * 100) },
                                { label: 'Zone Transition', value: `${zoneA} → ${zoneB}`, score: Math.round(transProb * 100) },
                                { label: 'Dwell at End', value: hasDwell ? `${Math.round((lastDwell?.durationMs || 0) / 1000)}s dwell` : 'None', score: hasDwell ? 100 : 0 },
                              ].map(({ label, value, score: s }) => (
                                <div key={label} className="flex items-center gap-2">
                                  <span className="text-slate-500 w-28 shrink-0">{label}</span>
                                  <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${s >= 70 ? 'bg-emerald-400' : s >= 40 ? 'bg-amber-400' : 'bg-slate-300'}`}
                                      style={{ width: `${Math.max(0, s)}%` }}
                                    />
                                  </div>
                                  <span className="text-slate-400 w-16 text-right shrink-0 truncate" title={value}>{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}

                    {stitchSuggestions.length === 0 && (
                      <div className="text-center py-8 text-sm text-slate-400">
                        <HelpCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        No stitch pairs to score. Upload body tracking data.
                      </div>
                    )}
                  </div>

                  {/* Dwell summary per BCID */}
                  {Object.keys(dwellSegments).some(k => dwellSegments[k].length > 0) && (
                    <div className="mt-4">
                      <div className="mb-2 text-[11px] font-bold text-slate-500 uppercase tracking-wider">Dwell Behaviour</div>
                      <div className="space-y-2">
                        {Object.entries(dwellSegments)
                          .filter(([, segs]) => segs.length > 0)
                          .sort((a, b) => b[1].length - a[1].length)
                          .map(([bcid, segs]) => (
                            <div key={bcid} className="bg-white border border-slate-200 rounded-lg p-2.5 text-[11px]">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="font-bold text-slate-700 truncate max-w-[60%]" title={bcid}>{bcid}</span>
                                <span className="text-slate-400">{segs.length} dwell{segs.length > 1 ? 's' : ''}</span>
                              </div>
                              {segs.map((seg, idx) => (
                                <div key={idx} className="flex items-center justify-between text-slate-500 pl-1 border-l-2 border-indigo-200 mb-1">
                                  <span>Zone {seg.zoneId} · {Math.round(seg.durationMs / 1000)}s</span>
                                  <span className="text-slate-400">{seg.pointCount} pts</span>
                                </div>
                              ))}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
