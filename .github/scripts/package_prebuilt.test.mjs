import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packagePrebuilt } from './package_prebuilt.mjs';

test('function dependencies and internal links survive without the build checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uier-prebuilt-'));
    try {
        const configPath = join(root, '.vercel/output/functions/api.func/.vc-config.json');
        await mkdir(join(root, '.vercel/output/functions/api.func'), { recursive: true });
        await mkdir(join(root, 'node_modules/library'), { recursive: true });
        await writeFile(join(root, 'node_modules/library/index.js'), 'fixture');
        await symlink('library', join(root, 'node_modules/alias'));
        await writeFile(configPath, JSON.stringify({ filePathMap: {
            'lib/index.js': 'node_modules/library/index.js', 'lib/alias': 'node_modules/alias',
        } }));
        await packagePrebuilt(root);
        await rm(join(root, 'node_modules'), { recursive: true });
        const config = JSON.parse(await readFile(configPath, 'utf8'));
        assert.equal(await readFile(join(root, '.vercel/output/runtime-files/node_modules/alias/index.js'), 'utf8'), 'fixture');
        assert.ok(Object.values(config.filePathMap).every(path => path.startsWith('.vercel/output/runtime-files/')));
        assert.deepEqual(Object.keys(config.filePathMap), ['lib/index.js', 'lib/alias']);
        for (const source of Object.values(config.filePathMap))
            await stat(join(root, source));
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('concurrent copies deduplicate shared dependencies and support repeat packaging', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uier-prebuilt-'));
    try {
        await mkdir(join(root, 'node_modules/library'), { recursive: true });
        const filePathMap = {};
        // More than one batch, shared by several functions; the alias can be copied before its target.
        for (let index = 0; index < 40; index++) {
            const name = `${index}.js`;
            await writeFile(join(root, 'node_modules/library', name), `export default ${index};`);
            filePathMap[`lib/${name}`] = `node_modules/library/${name}`;
        }
        await symlink('library', join(root, 'node_modules/alias'));
        filePathMap['lib/alias'] = 'node_modules/alias';
        const configs = ['a', 'b', 'c'].map(name => join(root, '.vercel/output/functions', `${name}.func`, '.vc-config.json'));
        for (const path of configs) {
            await mkdir(join(path, '..'), { recursive: true });
            await writeFile(path, JSON.stringify({ filePathMap }));
        }
        await packagePrebuilt(root);
        await rm(join(root, 'node_modules'), { recursive: true });
        await packagePrebuilt(root);
        assert.equal((await readdir(join(root, '.vercel/output/runtime-files/node_modules/library'))).length, 40);
        for (const path of configs) {
            const config = JSON.parse(await readFile(path, 'utf8'));
            for (const source of Object.values(config.filePathMap)) await stat(join(root, source));
        }
        assert.equal(await readFile(join(root, '.vercel/output/runtime-files/node_modules/alias/39.js'), 'utf8'), 'export default 39;');
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('batch packaging still rejects dependencies that escape the checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uier-prebuilt-'));
    try {
        const configPath = join(root, '.vercel/output/functions/api.func/.vc-config.json');
        await mkdir(join(configPath, '..'), { recursive: true });
        await symlink(tmpdir(), join(root, 'outside'));
        await writeFile(configPath, JSON.stringify({ filePathMap: { 'lib/outside': 'outside' } }));
        await assert.rejects(packagePrebuilt(root), /escapes checkout/);
        assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).filePathMap, { 'lib/outside': 'outside' });
    } finally { await rm(root, { recursive: true, force: true }); }
});
