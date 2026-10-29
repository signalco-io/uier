// Render listing artwork from the existing brand vectors and fonts. No customer data.
// Run from apps/web: node scripts/render-integration-listings.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { ImageResponse } from 'next/og.js';
import sharp from 'sharp';
import { brand, MARK_PATH, MARK_VIEWBOX, PIN_PATH, PIN_VIEWBOX } from '../../../packages/brand/src/brand.ts';
import { integrationCatalog } from '../src/lib/integrations/catalog.ts';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(webRoot, 'public/integrations');
await mkdir(output, { recursive: true });
const { ink, paper, ink700, ink500, ink200, ink100 } = brand.colors;
const fonts = await Promise.all([
    ['Geist', 'geist-sans/Geist-Regular.ttf', 400],
    ['Geist', 'geist-sans/Geist-SemiBold.ttf', 600],
    ['Geist Mono', 'geist-mono/GeistMono-Regular.ttf', 400]
].map(async ([name, file, weight]) => ({ name, weight, style: 'normal',
    data: await readFile(join(webRoot, 'node_modules/geist/dist/fonts', file)) })));

const row = (style, ...children) => h('div', { style: { display: 'flex', ...style } }, ...children);
const text = (value, style = {}) => row(style, value);
const mark = (size, color = ink) => h('svg', { viewBox: MARK_VIEWBOX, width: size, height: size }, h('path', { d: MARK_PATH, fill: color }));
const pin = size => h('svg', { viewBox: PIN_VIEWBOX, width: size, height: size }, h('path', { d: PIN_PATH, fill: ink }));
const line = (width = '100%') => row({ height: 10, width, borderRadius: brand.radius.smallControl, background: ink200 });

async function png(file, width, height, content) {
    const image = new ImageResponse(content, { width, height, fonts });
    await writeFile(join(output, file), Buffer.from(await image.arrayBuffer()));
}

for (const [key, integration] of Object.entries(integrationCatalog)) {
    const targetTitle = key === 'notion' ? 'Website feedback' : key === 'slack' ? '#website-feedback' : 'Heading spacing';
    await png(`${key}-showcase.png`, 1600, 1000,
        row({ width: '100%', height: '100%', padding: 72, background: paper, color: ink, fontFamily: 'Geist', flexDirection: 'column', justifyContent: 'space-between' },
            row({ alignItems: 'center', gap: 16 }, mark(40), text(brand.name, { fontSize: 44, fontWeight: 600, letterSpacing: '-0.045em' })),
            row({ flexDirection: 'column', gap: 20 },
                text(integration.title, { fontSize: 64, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.05, maxWidth: 1160 }),
                text(integration.result, { fontSize: 28, color: ink700 })),
            row({ alignItems: 'center', gap: 30, width: '100%' },
                row({ flexDirection: 'column', gap: 28, width: 650, height: 390, border: `1px solid ${ink200}`, borderRadius: brand.radius.panel, padding: 32 },
                    text('Feedback on your website', { fontSize: 24, fontWeight: 600 }),
                    row({ alignItems: 'center', gap: 16 }, pin(40), text('Heading spacing', { fontSize: 30, fontWeight: 600 })),
                    text('A little more space above the heading.', { fontSize: 26, lineHeight: 1.4 }),
                    row({ flexDirection: 'column', gap: 14, marginTop: 10 }, line('85%'), line('62%')),
                    text('Shared feedback · 1 reply', { fontSize: 20, color: ink500, marginTop: 'auto' })),
                h('svg', { width: 56, height: 56, viewBox: '0 0 24 24', fill: 'none', stroke: ink, strokeWidth: 1.75 },
                    h('path', { d: 'M3 12h18M14 5l7 7-7 7', strokeLinecap: 'round', strokeLinejoin: 'round' })),
                row({ flexDirection: 'column', gap: 24, flex: 1, height: 390, background: ink100, border: `1px solid ${ink200}`, borderRadius: brand.radius.panel, padding: 32 },
                    text(integration.name, { fontSize: 24, fontWeight: 600 }),
                    text(targetTitle, { fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em' }),
                    text(key === 'slack' ? 'New shared feedback in uier' : 'A little more space above the heading.', { fontSize: 26, lineHeight: 1.4 }),
                    text(key === 'slack' ? 'Open the thread in uier' : 'Page context · Discussion · Status', { fontSize: 22, color: ink700 }),
                    text(key === 'slack' ? 'Notifications from uier' : 'Updated from uier', { fontSize: 20, color: ink500, marginTop: 'auto' }))),
            row({ justifyContent: 'space-between', alignItems: 'center' },
                text(`${brand.domain}/integrations/${key}`, { fontFamily: 'Geist Mono', fontSize: 22, color: ink700 }),
                text('Product illustration', { fontSize: 18, color: ink500 }))));
}

for (const [source, destination] of [['mark.svg', 'icon.png'], ['mark-white.svg', 'icon-white.png']]) {
    const svg = await readFile(join(webRoot, '../../packages/brand/assets', source));
    await sharp(svg).resize(320, 320).png().toFile(join(output, destination));
}
// GitHub overlays the app name and logo on its feature card. Leave their area quiet.
await png('github-feature.png', 965, 482,
    row({ width: '100%', height: '100%', background: paper, padding: 48, alignItems: 'flex-end', justifyContent: 'flex-end' },
        row({ gap: 18, alignItems: 'flex-end' }, mark(64, ink200), mark(104, ink200), mark(168, ink200))));
console.log(`Rendered listing artwork in ${output}`);
