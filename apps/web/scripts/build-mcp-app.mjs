import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

const root = fileURLToPath(new URL('../', import.meta.url));
const cssPath = join(root, 'src/mcp-app/thread.css');
const [{ outputFiles }, styles] = await Promise.all([
    build({ entryPoints: [join(root, 'src/mcp-app/thread.tsx')], bundle: true, write: false,
        platform: 'browser', format: 'iife', minify: true, legalComments: 'inline',
        define: { 'process.env.NODE_ENV': '"production"' }, tsconfig: join(root, 'tsconfig.json') }),
    postcss([tailwind({ base: root })]).process(await readFile(cssPath, 'utf8'), { from: cssPath }),
]);
const css = (await transform(styles.css, { loader: 'css', minify: true })).code;
const fonts = dirname(createRequire(import.meta.url).resolve('geist/font'));
const font = await readFile(join(fonts, 'fonts/geist-sans/Geist-Variable.woff2'));
const license = await readFile(join(fonts, '../LICENSE.txt'), 'utf8');
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>uier thread</title><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:100 900;font-display:swap}${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><script>${outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script><!-- ${license.replace(/--/g, '—')} --></body></html>`;
await mkdir(join(root, 'dist/mcp'), { recursive: true });
await writeFile(join(root, 'dist/mcp/thread.html'), html);
console.log(`MCP thread card: ${Math.round(Buffer.byteLength(html) / 1024)} KiB`);
