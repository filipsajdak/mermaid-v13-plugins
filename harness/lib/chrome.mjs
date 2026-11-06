// @ts-check
/**
 * Rasterising through the system Chrome, headless. Every SVG, v12 and v13 alike, goes through
 * the same browser: v13 styles through `--mermaid-*` CSS variables, which `rsvg-convert` does not
 * reliably honour. No browser is downloaded; set `CHROME_PATH` when Chrome is elsewhere.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** The Chrome executable: `CHROME_PATH`, else the first one installed. */
export function chromePath() {
  const fromEnv = process.env['CHROME_PATH'];
  if (fromEnv) return fromEnv;
  const found = CANDIDATES.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome found; set CHROME_PATH to its executable.');
  return found;
}

/**
 * Runs `work` with a headless browser of its own (a fresh profile, never a running Chrome),
 * and closes it afterwards.
 * @template T
 * @param {(browser: import('puppeteer-core').Browser) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withBrowser(work) {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu'],
  });
  try {
    return await work(browser);
  } finally {
    await browser.close();
  }
}

/**
 * Screenshots an HTML document's `selector` element to `pngPath`.
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} html
 * @param {string} selector
 * @param {string} pngPath
 * @param {{ scale?: number }} [options]
 */
export async function screenshot(browser, html, selector, pngPath, { scale = 2 } = {}) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: 'load' });
    const el = await page.$(selector);
    if (!el) throw new Error(`Nothing matches ${selector}`);
    const png = await el.screenshot({ type: 'png' });
    await writeFile(pngPath, png);
  } finally {
    await page.close();
  }
}

/**
 * Rasterises one SVG document to `pngPath`, on white.
 * @param {import('puppeteer-core').Browser} browser
 * @param {string} svg
 * @param {string} pngPath
 */
export function rasterize(browser, svg, pngPath) {
  const html = `<!doctype html><html><body style="margin:0;background:#fff"><div id="d" style="display:inline-block">${svg}</div></body></html>`;
  return screenshot(browser, html, '#d', pngPath);
}
