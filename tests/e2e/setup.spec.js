import { test, expect } from '@playwright/test';
import { FLOORPLAN, TRACKING_CSV, loadMap } from './helpers.js';

test.describe('Setup page', () => {
  test('shows the setup screen on initial load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Floor Plan Data Mapper');
    await expect(page.locator('text=Upload Floor Plan Image')).toBeVisible();
    await expect(page.locator('text=Upload Tracking Data')).toBeVisible();
  });

  test('Generate Map button is disabled until both files are uploaded', async ({ page }) => {
    await page.goto('/');
    const btn = page.locator('button:has-text("Generate Map")');
    await expect(btn).toBeDisabled();

    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(FLOORPLAN);
    await expect(btn).toBeDisabled(); // still needs CSV

    await page.locator('input[type="file"][accept=".csv"]').setInputFiles(TRACKING_CSV);
    await page.waitForSelector('text=/CSV Loaded/', { timeout: 15_000 });
    await expect(btn).toBeEnabled();
  });

  test('shows floor plan loaded confirmation after image upload', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(FLOORPLAN);
    await expect(page.locator('text=Floor Plan Loaded Successfully')).toBeVisible();
  });

  test('shows CSV loaded stats after CSV upload', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(FLOORPLAN);
    await page.locator('input[type="file"][accept=".csv"]').setInputFiles(TRACKING_CSV);
    await expect(page.locator('text=/CSV Loaded:.*bodies/')).toBeVisible({ timeout: 15_000 });
  });

  test('navigates to map view after Generate Map', async ({ page }) => {
    await loadMap(page);
    await expect(page.locator('h1:has-text("Floor Plan View"), text=Floor Plan View')).toBeVisible();
  });
});
