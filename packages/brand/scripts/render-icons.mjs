// Renders the PNG icon set for apps/web/public from the mark (see BRAND.md, "App icon").
// Run `pnpm -C packages/brand icons` after changing the mark; commit the output.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const MARK_PATH = 'M0 0h12a12 12 0 0 1 12 12a12 12 0 0 1-12 12a12 12 0 0 1-12-12z';
const INK = '#0A0A0A';
const BLACK = '#000000';
const WHITE = '#FFFFFF';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', '..', 'apps', 'web', 'public');

/** Bare mark on a transparent background (favicon PNG fallbacks). */
function markSvg(fill) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="${MARK_PATH}"/></svg>`;
}

/**
 * App icon: black plate, white mark at 54% of the side, nudged 1.5% down and right so the
 * sharp corner does not pull it off centre. Square: iOS, Android and the manifest apply
 * their own masks, and the mark stays inside the central 80% safe zone of maskable icons.
 */
function plateSvg() {
    const scale = 54 / 24;
    const offset = (100 - 54) / 2 + 1.5;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${BLACK}"/><g transform="translate(${offset} ${offset}) scale(${scale})"><path fill="${WHITE}" d="${MARK_PATH}"/></g></svg>`;
}

const outputs = [
    { file: 'favicon-16x16.png', svg: markSvg(INK), size: 16 },
    { file: 'favicon-32x32.png', svg: markSvg(INK), size: 32 },
    { file: 'apple-touch-icon.png', svg: plateSvg(), size: 180 },
    { file: 'android-chrome-192x192.png', svg: plateSvg(), size: 192 },
    { file: 'android-chrome-512x512.png', svg: plateSvg(), size: 512 }
];

await mkdir(outDir, { recursive: true });
for (const { file, svg, size } of outputs) {
    const png = await sharp(Buffer.from(svg), { density: 384 })
        .resize(size, size)
        .png()
        .toBuffer();
    await writeFile(join(outDir, file), png);
    console.log(`${file} (${size}×${size})`);
}
