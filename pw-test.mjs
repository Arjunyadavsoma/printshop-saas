import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto('http://localhost:3000/', { timeout: 15000, waitUntil: 'domcontentloaded' });
  console.log('STATUS: loaded');
  console.log('TITLE:', await page.title());
  await page.screenshot({ path: '/home/z/my-project/pw-home.png' });
  console.log('SCREENSHOT: pw-home.png');
} catch (e) {
  console.log('STATUS: failed');
  console.log('ERROR:', e.message.split('\n')[0]);
} finally {
  await browser.close();
}
