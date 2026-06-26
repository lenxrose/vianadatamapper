import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, Map as MapIcon, Settings, Eye, EyeOff, Info, CheckCircle2, Search, ZoomIn, ZoomOut, Menu, GitCommit, HelpCircle, RefreshCw } from 'lucide-react';

export default function App() {
  const [appState, setAppState] = useState('setup'); // 'setup', 'loading', 'map'
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

  // Parse CSV function for both Body and Touch points
  const parseCSV = (text) => {
    const lines = text.split('\n');
    if (lines.length < 1) return { body: [], touches: [] };

    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));

    const bcidIdx = headers.indexOf('bcid');
    const floorPtIdx = headers.indexOf('floor_pt_fused');
    const eventTsIdx = headers.indexOf('event_ts');
    const touchesIdx = headers.indexOf('touches');

    if (bcidIdx === -1) {
      alert("Error: The CSV file must contain a 'bcid' column.");
      return { body: [], touches: [] };
    }

    const bodyPoints = [];
    const touchPoints = [];
    let isNormalized = true;

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;

      const row = [];
      let inQuotes = false;
      let val = '';
      for (let j = 0; j < lines[i].length; j++) {
        const c = lines[i][j];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === ',' && !inQuotes) { row.push(val); val = ''; }
        else val += c;
      }
      row.push(val);

      const bcid = row[bcidIdx]?.replace(/^"|"$/g, '');
      if (!bcid) continue;

      const tsStr = eventTsIdx !== -1 ? row[eventTsIdx]?.replace(/^"|"$/g, '') : null;
      const timestamp = tsStr ? new Date(tsStr).getTime() : i * 100;

      // 1. Process Body Detections (floor_pt_fused)
      if (floorPtIdx !== -1 && row[floorPtIdx]) {
        const match = row[floorPtIdx].match(/\[\s*([\d.-]+)\s*,\s*([\d.-]+)/);
        if (match) {
          const x = parseFloat(match[1]);
          const y = parseFloat(match[2]);
          if (x > 2 || y > 2) isNormalized = false;
          bodyPoints.push({ id: `b${i}`, rowIndex: i, bcid, rawX: x, rawY: y, timestamp, type: 'body' });
        }
      }

      // 2. Process Touch Points (extracting nested floor_pt from touches column)
      if (touchesIdx !== -1 && row[touchesIdx] && row[touchesIdx].trim() !== '') {
        const touchMatches = [...row[touchesIdx].matchAll(/floor_pt[^\w\{]*\{([^}]+)\}/g)];
        touchMatches.forEach((tm, tIdx) => {
          const innerProps = tm[1];
          const xMatch = innerProps.match(/x\\?["']?\s*:\s*([\d.-]+)/);
          const yMatch = innerProps.match(/y\\?["']?\s*:\s*([\d.-]+)/);

          if (xMatch && yMatch) {
            const tx = parseFloat(xMatch[1]);
            const ty = parseFloat(yMatch[1]);
            if (tx > 2 || ty > 2) isNormalized = false;
            touchPoints.push({ id: `t${i}-${tIdx}`, rowIndex: i, bcid, rawX: tx, rawY: ty, timestamp, type: 'touch' });
          }
        });
      }
    }

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
    const reader = new FileReader();
    reader.onload = (event) => {
      const parsedData = parseCSV(event.target.result);

      const colors = {};
      const allUniqueBcids = [...new Set([
        ...parsedData.body.map(d => d.bcid),
        ...parsedData.touches.map(d => d.bcid)
      ])];

      allUniqueBcids.forEach((id, index) => {
        const hue = Math.floor((index / allUniqueBcids.length) * 360);
        colors[id] = `hsl(${hue}, 75%, 75%)`;
      });

      setBcidColors(colors);
      setCsvData(parsedData);
      setMerges({}); // Reset any merges from previous data
    };
    reader.readAsText(file);
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
    const maxTimeGapMs = 15000; // 15 seconds threshold
    const maxDistPixels = 120; // Maximum distance to consider

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
  }, [csvData.body, scaleCoordinates, resolution]);

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
      } else {
        s.durationStr = 'N/A';
      }
    });

    return stats;
  }, [activeData, merges]);

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

    // 3. Render the paths
    Object.entries(groupedData).forEach(([repBcid, points]) => {
      if (hiddenBcids.has(repBcid)) return;
      if (searchQuery && !repBcid.toLowerCase().includes(searchQuery.toLowerCase())) return;

      const color = bcidColors[repBcid] || '#ccc';

      if (renderMode === 'dots') {
        points.forEach(point => {
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
        const sortedPoints = [...points].sort((a, b) => {
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

          ctx.beginPath();
          ctx.arc(endPt.x, endPt.y, 5, 0, 2*Math.PI);
          ctx.fillStyle = '#ef4444';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        }
      }
    });
  }, [appState, displayData, hiddenBcids, bcidColors, searchQuery, renderMode, dataSource, merges, hoveredSuggestion]);

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

            <div className={`border-2 border-dashed rounded-xl p-6 transition-colors ${(csvData.body.length > 0 || csvData.touches.length > 0) ? 'border-green-400 bg-green-50' : 'border-slate-300 hover:border-indigo-400 bg-slate-50'}`}>
              <label className="flex flex-col items-center cursor-pointer">
                {(csvData.body.length > 0 || csvData.touches.length > 0) ? <CheckCircle2 className="text-green-500 w-10 h-10 mb-2" /> : <Upload className="text-slate-400 w-10 h-10 mb-2" />}
                <span className="text-sm font-medium text-slate-700">
                  {(csvData.body.length > 0 || csvData.touches.length > 0)
                    ? `CSV Loaded: ${csvData.body.length} bodies, ${csvData.touches.length} touches`
                    : '2. Upload Tracking Data (CSV)'}
                </span>
                <span className="text-xs text-slate-500 mt-1">Must contain 'bcid', 'floor_pt_fused', and optionally 'touches'</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleCsvUpload} />
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
            onClick={() => setAppState('setup')}
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
            </div>

            <div className="p-4 flex-1 overflow-y-auto">
              {sidebarTab === 'legend' ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Paths</h3>
                    <button
                      onClick={toggleAllBcids}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      {hiddenBcids.size === 0 ? 'Hide All' : 'Show All'}
                    </button>
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
                          {stats.mergedChildren.length > 0 && (
                            <div className="mt-1.5 pl-7 text-[10px] text-slate-400 font-medium">
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
              ) : (
                <>
                  <div className="mb-3 p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-slate-600 space-y-1.5">
                    <div className="font-bold text-indigo-800 flex items-center gap-1.5">
                      <Info className="w-4 h-4 text-indigo-600" /> Chronological Stitch Finder
                    </div>
                    <p className="leading-relaxed">
                      Scans coordinates and event timestamps to identify separate track segments that ended and started within 15 seconds and 120 pixels of each other.
                    </p>
                  </div>

                  <div className="space-y-2 mt-4">
                    {stitchSuggestions.map((sug) => {
                      const isAlreadyStitched = getMergedRepresentative(sug.to, merges) === getMergedRepresentative(sug.from, merges);

                      return (
                        <div
                          key={sug.id}
                          onMouseEnter={() => setHoveredSuggestion(sug)}
                          onMouseLeave={() => setHoveredSuggestion(null)}
                          className={`p-3 border rounded-lg transition-all flex flex-col justify-between gap-2 bg-white ${isAlreadyStitched ? 'border-green-200 bg-green-50/20' : 'border-slate-200 hover:border-indigo-300 hover:shadow-sm'}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col max-w-[70%]">
                              <span className="text-xs font-bold text-slate-700 truncate" title={sug.from}>{sug.from}</span>
                              <span className="text-[10px] text-slate-400 font-medium">ended</span>
                            </div>
                            <span className="text-slate-400 text-xs font-bold">➡️</span>
                            <div className="flex flex-col max-w-[70%] text-right">
                              <span className="text-xs font-bold text-slate-700 truncate" title={sug.to}>{sug.to}</span>
                              <span className="text-[10px] text-slate-400 font-medium">started</span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                            <span>Gap: <strong>{Math.round(sug.timeGapMs / 100) / 10}s</strong></span>
                            <span>Distance: <strong>{Math.round(sug.distance)}px</strong></span>
                          </div>

                          {isAlreadyStitched ? (
                            <div className="w-full text-center py-1.5 text-xs text-green-700 font-bold bg-green-100/60 rounded border border-green-200">
                              ✓ Tracks Stitched
                            </div>
                          ) : (
                            <button
                              onClick={() => handleStitch(sug.from, sug.to)}
                              className="w-full py-1.5 text-xs text-white bg-indigo-600 hover:bg-indigo-700 font-bold rounded transition-colors"
                            >
                              Stitch Tracks
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {stitchSuggestions.length === 0 && (
                      <div className="text-center py-8 text-sm text-slate-400">
                        <HelpCircle className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                        No stitchable track pairs detected within 15 seconds and 120 pixels.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
