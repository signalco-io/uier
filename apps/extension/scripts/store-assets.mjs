// Render listing artwork from canonical brand assets; no store access or customer data.
// The promotional tile is the brand social card at store size (BRAND.md, "Marketing and metadata"):
// paper, the lockup, the tagline, uier.io in mono, and the pin and toolbar as the motif.
import { chromium } from '@playwright/test';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { brand, PIN_PATH, PIN_VIEWBOX } from '../../../packages/brand/src/brand.ts';
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'release/listing');
await mkdir(out, { recursive: true });
await copyFile(resolve(root, 'dist/icons/128.png'), resolve(out, 'store-icon-128.png'));
const logo = await readFile(resolve(root, '../../packages/brand/assets/logo.svg'), 'utf8');
const tokens = await readFile(resolve(root, '../../packages/brand/tokens.css'), 'utf8');
const geist = dirname(createRequire(import.meta.url).resolve('geist/font'));
const font = async file => (await readFile(resolve(geist, file))).toString('base64');
const [sans, mono] = await Promise.all([font('fonts/geist-sans/Geist-Variable.woff2'), font('fonts/geist-mono/GeistMono-Variable.woff2')]);
const { paper, ink, black, darkBorder } = brand.colors;
// The product pin (ink, 2 px paper ring, the number inside) and the toolbar pill: add a comment, then the inbox
const pin = `<div class="pin"><svg viewBox="${PIN_VIEWBOX}"><path d="${PIN_PATH}" fill="${ink}" stroke="${paper}" stroke-width="2"/></svg><span>1</span></div>`;
const toolbar = `<div class="pill">
    <span class="button add"><svg viewBox="${PIN_VIEWBOX}" fill="none"><path d="${PIN_PATH}" stroke="${paper}" stroke-width="1.75"/><path d="M9 16h14M16 9v14" stroke="${paper}" stroke-width="2" stroke-linecap="round"/></svg></span>
    <span class="button"><svg viewBox="0 0 24 24" fill="none" stroke="${paper}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg></span>
</div>`;
const browser = await chromium.launch({ channel: 'chromium' });
try {
    const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html lang="en"><title>uier</title><style>${tokens}
        @font-face { font-family: Geist; src: url(data:font/woff2;base64,${sans}) format('woff2'); font-weight: 100 900; }
        @font-face { font-family: 'Geist Mono'; src: url(data:font/woff2;base64,${mono}) format('woff2'); font-weight: 100 900; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 28px 32px; height: 280px; background: hsl(var(--background)); color: hsl(var(--foreground)); font-family: Geist, system-ui, sans-serif; display: flex; flex-direction: column; justify-content: space-between; }
        body > svg { width: 88px; height: 26px; }
        h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: -.03em; font-weight: 600; }
        p { margin: 8px 0 0; font-size: 15px; line-height: 1.45; color: hsl(var(--muted-foreground)); }
        footer { display: flex; align-items: center; justify-content: space-between; }
        .address { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 13px; color: hsl(var(--secondary-foreground)); }
        .motif { display: flex; align-items: center; gap: 16px; }
        .pin { position: relative; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; color: ${paper}; font-size: 11px; font-weight: 600; }
        .pin svg { position: absolute; inset: 0; width: 100%; height: 100%; }
        .pin span { position: relative; }
        .pill { display: flex; align-items: center; gap: 2px; padding: 3px; border-radius: 999px; background: ${black}; border: 1px solid ${darkBorder}; }
        .button { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 999px; }
        .button.add { background: ${darkBorder}; }
        .button svg { width: 16px; height: 16px; }
        </style></head><body>${logo}<div><h1>${brand.tagline}</h1><p>Review configured sites from your browser.<br>Comments stay pinned to the page.</p></div>
        <footer><span class="address">${brand.domain}</span><div class="motif">${pin}${toolbar}</div></footer></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(out, 'promotional-tile-440x280.png') });
} finally { await browser.close(); }
console.log(`Brand listing artwork: ${out}. The actual 1280x800 runtime screenshot is retained by test:package.`);
