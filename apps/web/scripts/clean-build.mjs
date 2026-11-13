import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A cached build must replace the previous artifact, including files written by next start.
// Keep the compiler cache and the running development server's separate output.
export async function cleanBuild(directory) {
    let entries;
    try { entries = await readdir(directory); }
    catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    await Promise.all(entries.filter(name => name !== 'cache' && name !== 'dev')
        .map(name => rm(join(directory, name), { recursive: true, force: true })));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    await cleanBuild(fileURLToPath(new URL('../.next/', import.meta.url)));
