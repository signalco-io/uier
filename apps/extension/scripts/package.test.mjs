import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, utimesSync } from 'node:fs';
import { resolve } from 'node:path';

test('the same production resources produce identical ZIP bytes despite filesystem timestamps', () => {
    const root = resolve(import.meta.dirname, '..');
    const file = resolve(root, 'dist/manifest.json');
    const times = statSync(file);
    const version = JSON.parse(readFileSync(resolve(root, 'package.json'))).version;
    const zip = resolve(root, `release/uier-extension-${version}.zip`);
    const pack = () => { execFileSync(process.execPath, ['scripts/package.mjs'], { cwd: root }); return readFileSync(zip); };
    try {
        const first = pack();
        utimesSync(file, new Date(), new Date());
        assert.deepEqual(pack(), first);
    } finally { utimesSync(file, times.atime, times.mtime); }
});
