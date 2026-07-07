// Questman README screenshot capture — drives the LIVE app with headless
// Chromium and writes staged PNGs to ./shots/. See SKILL.md for the full flow
// (run → verify each via the Read tool → promote to docs/screenshots/).
//
// Config lives in CONFIG below; update it when nav labels or the shot set change.

import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CONFIG = {
  base: process.env.BASE || 'http://localhost:8080', // dev mode: http://localhost:5173
  login: { email: 'demo@daymon.app', password: 'demo123' },
  tokenKey: 'questman.auth.token',
  viewport: { width: 1170, height: 720, deviceScaleFactor: 2 }, // matches existing docs/screenshots
  outDir: fileURLToPath(new URL('./shots/', import.meta.url)),
  // Ordered capture steps. Each: { file, nav?: deckLabel, theme?: ''|skin, action?: 'jackin' }
  shots: [
    { file: 'today.png',           nav: 'Today',       theme: '' },
    { file: 'today-synthwave.png',                     theme: 'synthwave' }, // stays on Today
    { file: 'shop.png',            nav: 'Shop',        theme: '' },
    { file: 'finance.png',         nav: 'Finance' },
    { file: 'progress.png',        nav: 'Street Cred' },
    { file: 'focus.png',           nav: 'Today',       action: 'jackin' },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(CONFIG.outDir, { recursive: true });

  // 1. Authenticate via the API and grab a JWT.
  const res = await fetch(`${CONFIG.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(CONFIG.login),
  });
  const body = await res.json();
  if (!body.token) throw new Error('login failed: ' + JSON.stringify(body).slice(0, 200));

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport(CONFIG.viewport);

    // 2. Inject the token into localStorage on the app origin, then reload in.
    await page.goto(CONFIG.base, { waitUntil: 'networkidle2' });
    await page.evaluate((k, t) => localStorage.setItem(k, t), CONFIG.tokenKey, body.token);
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(3000); // CRT frame + entrance stagger settle

    // 3. Hide shop ambient FX overlays (drizzle/rain/matrix/dust/VHS) — they read
    //    as static noise in a still frame. Base CRT/scanlines/glow/chroma are kept.
    await page.addStyleTag({ content: `.fxo { display: none !important; }` });
    await sleep(300);

    const setTheme = (t) => page.evaluate((th) => {
      if (th) document.documentElement.setAttribute('data-theme', th);
      else document.documentElement.removeAttribute('data-theme');
    }, t);

    const nav = (label) => page.evaluate((lbl) => {
      const els = [...document.querySelectorAll('button, a, [role=button]')];
      let el = els.find((e) => (e.textContent || '').trim() === lbl);
      if (!el) el = els.find((e) => (e.textContent || '').trim().includes(lbl));
      if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
      return false;
    }, label);

    const jackIn = () => page.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').includes('JACK IN'));
      if (el) { el.click(); return true; }
      return false;
    });

    // 4. Walk the shot list.
    for (const s of CONFIG.shots) {
      if (s.theme !== undefined) await setTheme(s.theme);
      if (s.nav) { const ok = await nav(s.nav); console.log(`  nav ${s.nav}: ${ok}`); await sleep(2000); }
      if (s.action === 'jackin') { const ok = await jackIn(); console.log(`  JACK IN: ${ok}`); await sleep(2200); }
      await sleep(900);
      await page.screenshot({ path: CONFIG.outDir + s.file });
      console.log(`  shot ${s.file}`);
    }
  } finally {
    await browser.close();
  }
  console.log(`DONE — staged in ${CONFIG.outDir}`);
}

main().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
