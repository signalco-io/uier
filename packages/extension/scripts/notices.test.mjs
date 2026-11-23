import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { kitLicense, kitNoticeTitle, kitPackages } from '../../ui-primitives/src/notice/index.ts';
import { checkPackagedNotices, noticesFile, thirdPartyNotices } from './notices.mjs';

const packages = resolve(import.meta.dirname, '../..');
const bundled = (...entries) => `(()=>{})();\n/*! Bundled license information:\n\n${entries.join('\n')}*/\n`;
const react = 'react/cjs/react.production.js:\n  (**\n   * @license React\n   * Copyright (c) Meta Platforms, Inc. and affiliates.\n   *)\n';
const icons = 'lucide-react/dist/esm/icons/x.js:\nlucide-react/dist/esm/icons/check.js:\n  (**\n   * @license lucide-react v0.507.0 - ISC\n   *)\n';

test('every UI kit package keeps the notice the artifacts embed', async () => {
    for (const name of kitPackages) {
        const directory = join(packages, name.replace('@uier/', ''));
        assert.equal(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name, name);
        assert.equal(await readFile(join(directory, 'LICENSE'), 'utf8'), kitLicense, `${name} LICENSE differs from kitLicense`);
    }
    assert.match(kitLicense, /^MIT License\n\nCopyright \(c\) signalco\n/);
    assert.match(kitLicense, /The above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software\./);
});

test('the notices name the UI kit with its full notice, then each bundled notice once', () => {
    const text = thirdPartyNotices({ content: bundled(react, icons), popup: bundled(react), worker: '(()=>{})();' });
    assert(text.includes(kitNoticeTitle) && text.includes(kitLicense.trim()));
    assert(text.indexOf(kitLicense.trim()) < text.indexOf('@license React'));
    assert.equal(text.split('@license React').length, 2);
    assert(text.includes('lucide-react/dist/esm/icons/check.js\nlucide-react/dist/esm/icons/x.js\n\n(**\n * @license lucide-react v0.507.0 - ISC\n *)'));
    // Without any bundled notice the UI kit's still ships.
    assert(thirdPartyNotices({ worker: '(()=>{})();' }).includes(kitLicense.trim()));
});

test('a package without the UI kit notice is refused', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uier-extension-notices-'));
    try {
        await assert.rejects(checkPackagedNotices(directory), /Missing packaged file THIRD-PARTY-NOTICES\.txt/);
        await writeFile(join(directory, noticesFile), thirdPartyNotices({}).replace('Copyright (c) signalco', 'Copyright (c) someone'));
        await assert.rejects(checkPackagedNotices(directory), /missing the UI kit's MIT notice/);
        await writeFile(join(directory, noticesFile), thirdPartyNotices({}));
        await checkPackagedNotices(directory);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
