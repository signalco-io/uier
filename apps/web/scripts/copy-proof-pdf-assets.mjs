import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageFile = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
const source = dirname(packageFile);
const { version } = JSON.parse(readFileSync(packageFile, 'utf8'));
const target = fileURLToPath(new URL(`../public/proof-pdf/${version}/`, import.meta.url));
const groups = {
    cmaps: /\.bcmap$/,
    standard_fonts: /\.(?:pfb|ttf)$/,
    wasm: /^(?:jbig2|openjpeg|qcms_bg)\.wasm$/
};

for (const [group, pattern] of Object.entries(groups)) {
    const dest = join(target, group);
    mkdirSync(dest, { recursive: true });
    for (const file of readdirSync(join(source, group))) {
        if (pattern.test(file) || file.startsWith('LICENSE'))
            copyFileSync(join(source, group, file), join(dest, file));
    }
}
copyFileSync(join(source, 'LICENSE'), join(target, 'LICENSE'));
