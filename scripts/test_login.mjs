import { chromium } from 'playwright';

async function testLogin() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('requestfailed', req => console.log('REQ FAIL:', req.url(), req.failure()?.errorText));
  page.on('response', res => {
    if (res.url().includes('/api/')) console.log('API RES:', res.status(), res.url());
  });

  console.log('Navigating to login...');
  await page.goto('http://localhost:8090/login', { waitUntil: 'networkidle' });

  console.log('Filling credentials...');
  const inputs = await page.locator('input').all();
  await inputs[0].fill('admin');
  await inputs[1].fill('321');
  
  const submitBtn = page.locator('button[type="submit"]');
  await submitBtn.click();

  await page.waitForTimeout(3000);
  console.log('Current URL after login:', page.url());

  const err = await page.locator('.text-destructive').textContent().catch(() => null);
  console.log('Error banner:', err);

  const authSession = await page.evaluate(() => localStorage.getItem('rematch_auth_session'));
  console.log('Stored rematch_auth_session:', authSession);

  await browser.close();
}

testLogin().catch(console.error);
