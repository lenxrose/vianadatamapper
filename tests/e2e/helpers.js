import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(__dirname, 'fixtures');
export const FLOORPLAN = path.join(FIXTURES, 'floorplan.png');
export const TRACKING_CSV = path.join(FIXTURES, 'tracking.csv');

/**
 * Upload floor plan + CSV and click "Generate Map".
 * Waits until the map view header is visible.
 */
export async function loadMap(page) {
  await page.goto('/');
  await page.waitForSelector('text=Floor Plan Data Mapper');

  const imageInput = page.locator('input[type="file"][accept="image/*"]');
  await imageInput.setInputFiles(FLOORPLAN);

  const csvInput = page.locator('input[type="file"][accept=".csv"]');
  await csvInput.setInputFiles(TRACKING_CSV);

  // Wait for CSV loaded confirmation text
  await page.waitForSelector('text=/CSV Loaded/', { timeout: 15_000 });

  await page.click('button:has-text("Generate Map")');
  await page.waitForSelector('text=Floor Plan View', { timeout: 10_000 });
}
