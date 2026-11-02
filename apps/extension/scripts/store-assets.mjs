// Render listing artwork from canonical brand assets; no store access or customer data.
import { chromium } from '@playwright/test';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brand } from '../../../packages/brand/src/brand.ts';
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'release/listing');
await mkdir(out, { recursive: true });
await copyFile(resolve(root, 'dist/icons/128.png'), resolve(out, 'store-icon-128.png'));
const logo = await readFile(resolve(root, '../../packages/brand/assets/logo.svg'), 'utf8');
const tokens = await readFile(resolve(root, '../../packages/brand/tokens.css'), 'utf8');
const font = (await readFile(resolve(root, '../web/public/toolbar-fonts/geist.woff2'))).toString('base64');
const browser = await chromium.launch({ channel: 'chromium' });
try {
    const page = await browser.newPage({ viewport: { width: 440, height: 280 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html lang="en"><title>uier</title><style>${tokens}
        @font-face { font-family: Geist; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 100 900; }
        * { box-sizing: border-box; } body { margin: 0; padding: 32px; height: 280px; background: hsl(var(--background)); color: hsl(var(--foreground)); font-family: Geist, system-ui, sans-serif; display: flex; flex-direction: column; justify-content: space-between; }
        svg { width: 108px; height: 32px; } h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: -.03em; font-weight: 600; } p { margin: 12px 0 0; font-size: 16px; line-height: 1.5; color: hsl(var(--muted-foreground)); }
        </style></head><body>${logo}<div><h1>${brand.tagline}</h1><p>Review configured sites.<br>Keep feedback on the page.</p></div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(out, 'promotional-tile-440x280.png') });
} finally { await browser.close(); }
console.log(`Brand listing artwork: ${out}. The actual 1280x800 runtime screenshot is retained by test:package.`);
