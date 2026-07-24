import { test } from '@playwright/test';

test('capture screenshot', async ({ page }) => {
  // Set viewport to mobile size since this is a driver view
  await page.setViewportSize({ width: 390, height: 844 });
  
  console.log('Navigating to login...');
  await page.goto('http://localhost:7173/login');
  await page.waitForTimeout(1000);
  
  console.log('Logging in as driver laixe...');
  const userFields = await page.$$('input');
  if (userFields.length >= 2) {
    await userFields[0].fill('laixe');
    await userFields[1].fill('admin123');
  } else {
    await page.fill('input[type="text"]', 'laixe');
    await page.fill('input[type="password"]', 'admin123');
  }
  
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  
  let currentUrl = page.url();
  console.log('Logged in, current URL:', currentUrl);
  
  if (currentUrl.includes('/login')) {
    console.log('Failed login with laixe/admin123. Trying quyet/admin123...');
    const userFields2 = await page.$$('input');
    if (userFields2.length >= 2) {
      await userFields2[0].fill('quyet');
      await userFields2[1].fill('admin123');
    }
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    currentUrl = page.url();
    console.log('Current URL after quyet login:', currentUrl);
  }
  
  console.log('Navigating to my-trips/81...');
  await page.goto('http://localhost:7173/my-trips/81');
  console.log('Waiting for content to load...');
  await page.waitForTimeout(4000); // Give it enough time to fetch and render
  
  const screenshotPath = '/Users/dev/.gemini/antigravity-cli/brain/3c2fe464-e600-4472-8ac9-ab6a86629a9c/my_trips_detail.png';
  console.log(`Taking screenshot to ${screenshotPath}...`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot captured successfully!');
});
