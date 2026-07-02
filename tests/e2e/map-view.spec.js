import { test, expect } from '@playwright/test';
import { loadMap } from './helpers.js';

test.describe('Map view — header controls', () => {
  test.beforeEach(async ({ page }) => {
    await loadMap(page);
  });

  test('renders the canvas', async ({ page }) => {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(100);
  });

  test('data source dropdown changes active selection', async ({ page }) => {
    const select = page.locator('select').first();
    await select.selectOption('touches');
    await expect(select).toHaveValue('touches');
    await select.selectOption('combined');
    await expect(select).toHaveValue('combined');
    await select.selectOption('body');
    await expect(select).toHaveValue('body');
  });

  test('render mode dropdown switches view mode', async ({ page }) => {
    const selects = page.locator('select');
    const renderSelect = selects.nth(1);
    await renderSelect.selectOption('trail');
    await expect(renderSelect).toHaveValue('trail');
    await renderSelect.selectOption('arrows');
    await expect(renderSelect).toHaveValue('arrows');
    await renderSelect.selectOption('dots');
    await expect(renderSelect).toHaveValue('dots');
  });

  test('Scale toggle is clickable', async ({ page }) => {
    // Find the toggle button by looking for the label + adjacent button
    const toggle = page.locator('button[class*="rounded-full"]').first();
    const initialClass = await toggle.getAttribute('class');
    await toggle.click();
    const afterClass = await toggle.getAttribute('class');
    // The class should change (bg-indigo-600 vs bg-slate-300)
    expect(initialClass).not.toEqual(afterClass);
  });

  test('sidebar toggle button shows/hides the sidebar', async ({ page }) => {
    await expect(page.locator('text=Data Overview')).toBeVisible();
    await page.locator('button[title="Toggle Data Overview Sidebar"]').click();
    await expect(page.locator('text=Data Overview')).not.toBeVisible();
    await page.locator('button[title="Toggle Data Overview Sidebar"]').click();
    await expect(page.locator('text=Data Overview')).toBeVisible();
  });

  test('Start Over returns to setup screen', async ({ page }) => {
    await page.click('button:has-text("Start Over")');
    await expect(page.locator('h1')).toContainText('Floor Plan Data Mapper');
  });
});

test.describe('Map view — zoom controls', () => {
  test.beforeEach(async ({ page }) => {
    await loadMap(page);
  });

  test('zoom in button increases zoom level', async ({ page }) => {
    const zoomDisplay = page.locator('div[title="Reset Zoom"]');
    await expect(zoomDisplay).toContainText('100%');
    await page.locator('button[title="Zoom In"]').click();
    await expect(zoomDisplay).toContainText('125%');
  });

  test('zoom out button decreases zoom level', async ({ page }) => {
    const zoomDisplay = page.locator('div[title="Reset Zoom"]');
    await page.locator('button[title="Zoom Out"]').click();
    await expect(zoomDisplay).toContainText('75%');
  });

  test('clicking zoom % resets to 100%', async ({ page }) => {
    await page.locator('button[title="Zoom In"]').click();
    await page.locator('button[title="Zoom In"]').click();
    await page.locator('div[title="Reset Zoom"]').click();
    await expect(page.locator('div[title="Reset Zoom"]')).toContainText('100%');
  });

  test('zoom does not go below 25%', async ({ page }) => {
    const zoomOut = page.locator('button[title="Zoom Out"]');
    for (let i = 0; i < 10; i++) await zoomOut.click();
    await expect(page.locator('div[title="Reset Zoom"]')).toContainText('25%');
  });

  test('zoom does not exceed 500%', async ({ page }) => {
    const zoomIn = page.locator('button[title="Zoom In"]');
    for (let i = 0; i < 20; i++) await zoomIn.click();
    await expect(page.locator('div[title="Reset Zoom"]')).toContainText('500%');
  });
});
