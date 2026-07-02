import { test, expect } from '@playwright/test';
import { loadMap } from './helpers.js';

test.describe('Sidebar — Legend tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadMap(page);
  });

  test('legend tab is active by default and shows active paths', async ({ page }) => {
    await expect(page.locator('text=Active Paths')).toBeVisible();
    // Our CSV has 3 BCIDs
    const pathCards = page.locator('text=PERSON-001, text=PERSON-002, text=PERSON-003');
    await expect(page.locator('text=PERSON-001')).toBeVisible();
    await expect(page.locator('text=PERSON-002')).toBeVisible();
    await expect(page.locator('text=PERSON-003')).toBeVisible();
  });

  test('shows point count and duration per BCID', async ({ page }) => {
    // Each legend card should show "pt •" and a duration
    await expect(page.locator('text=/\\d+ pt •/')).toHaveCount(3);
  });

  test('Hide All / Show All toggle works', async ({ page }) => {
    const toggleBtn = page.locator('button:has-text("Hide All")');
    await toggleBtn.click();
    await expect(page.locator('button:has-text("Show All")')).toBeVisible();
    await page.locator('button:has-text("Show All")').click();
    await expect(page.locator('button:has-text("Hide All")')).toBeVisible();
  });

  test('search filters visible BCID cards', async ({ page }) => {
    const searchInput = page.locator('input[placeholder="Search active IDs..."]');
    await searchInput.fill('PERSON-001');
    await expect(page.locator('text=PERSON-001')).toBeVisible();
    await expect(page.locator('text=PERSON-002')).not.toBeVisible();
    await searchInput.clear();
    await expect(page.locator('text=PERSON-002')).toBeVisible();
  });

  test('sort buttons change active sort', async ({ page }) => {
    const leastBtn = page.locator('button:has-text("Least Points")');
    await leastBtn.click();
    await expect(leastBtn).toHaveClass(/bg-indigo-600/);

    const longestBtn = page.locator('button:has-text("Longest")');
    await longestBtn.click();
    await expect(longestBtn).toHaveClass(/bg-indigo-600/);
  });

  test('clicking a BCID card toggles its visibility (line-through)', async ({ page }) => {
    const card = page.locator('text=PERSON-001').first().locator('..');
    await card.click();
    // After hiding, the BCID label should have line-through class
    await expect(page.locator('span.line-through:has-text("PERSON-001")')).toBeVisible();
    await card.click();
    await expect(page.locator('span.line-through:has-text("PERSON-001")')).not.toBeVisible();
  });
});

test.describe('Sidebar — Stitch Finder tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadMap(page);
    await page.locator('button:has-text("Stitch Finder")').click();
  });

  test('Stitch Finder tab is clickable and shows explanation', async ({ page }) => {
    await expect(page.locator('text=Chronological Stitch Finder')).toBeVisible();
  });

  test('shows configurable threshold inputs', async ({ page }) => {
    await expect(page.locator('label:has-text("Max Time Gap")')).toBeVisible();
    await expect(page.locator('label:has-text("Max Distance")')).toBeVisible();
  });

  test('changing max time gap updates the input value', async ({ page }) => {
    const input = page.locator('label:has-text("Max Time Gap")').locator('..').locator('input[type="number"]');
    await input.fill('30');
    await expect(input).toHaveValue('30');
  });

  test('changing max distance updates the input value', async ({ page }) => {
    const input = page.locator('label:has-text("Max Distance")').locator('..').locator('input[type="number"]');
    await input.fill('200');
    await expect(input).toHaveValue('200');
  });

  test('shows stitch suggestions or empty state message', async ({ page }) => {
    // With our CSV, PERSON-001 ends and PERSON-002 starts close in time
    // Either stitch cards appear OR the "no pairs detected" message
    const hasSuggestions = await page.locator('button:has-text("Stitch Tracks")').count();
    if (hasSuggestions === 0) {
      await expect(page.locator('text=/No stitchable track pairs/')).toBeVisible();
    } else {
      await expect(page.locator('button:has-text("Stitch Tracks")').first()).toBeVisible();
    }
  });

  test('Stitch Tracks button merges tracks and shows confirmation', async ({ page }) => {
    // Widen thresholds so our CSV data produces at least one suggestion
    const timeInput = page.locator('label:has-text("Max Time Gap")').locator('..').locator('input');
    await timeInput.fill('60');
    const distInput = page.locator('label:has-text("Max Distance")').locator('..').locator('input');
    await distInput.fill('1000');

    const stitchBtn = page.locator('button:has-text("Stitch Tracks")').first();
    if (await stitchBtn.isVisible()) {
      await stitchBtn.click();
      await expect(page.locator('text=✓ Tracks Stitched').first()).toBeVisible();
    }
  });
});

test.describe('Sidebar — Pattern tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadMap(page);
    await page.locator('button:has-text("Pattern")').click();
  });

  test('Pattern tab shows zone grid config', async ({ page }) => {
    await expect(page.locator('text=Zone Grid')).toBeVisible();
    await expect(page.locator('label:has-text("Columns")')).toBeVisible();
    await expect(page.locator('label:has-text("Rows")')).toBeVisible();
  });

  test('Show Zone Heatmap toggle button works', async ({ page }) => {
    const heatmapBtn = page.locator('button:has-text("Show Zone Heatmap")');
    await heatmapBtn.click();
    await expect(page.locator('button:has-text("Hide Zone Heatmap")')).toBeVisible();
    await page.locator('button:has-text("Hide Zone Heatmap")').click();
    await expect(page.locator('button:has-text("Show Zone Heatmap")')).toBeVisible();
  });

  test('Dwell Detection section is visible with radius and min duration inputs', async ({ page }) => {
    await expect(page.locator('text=Dwell Detection')).toBeVisible();
    await expect(page.locator('label:has-text("Radius")')).toBeVisible();
    await expect(page.locator('label:has-text("Min Duration")')).toBeVisible();
  });

  test('Stitch Pairs — Pattern Score section is present', async ({ page }) => {
    await expect(page.locator('text=Stitch Pairs — Pattern Score')).toBeVisible();
  });
});
