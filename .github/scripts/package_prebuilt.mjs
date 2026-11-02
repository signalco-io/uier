import { copyFile, lstat, mkdir, readFile, readdir, readlink, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const prefix = '.vercel/output/runtime-files';
function safePath(value) {
    if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\')
        || value.split('/').some(part => !part || part === '.' || part === '..' || part === '.env' || part.startsWith('.env.')))
        throw new Error('Invalid prebuilt dependency path.');
    return value;
}
function inside(root, path) {
    const value = relative(root, path);
    return value !== '..' && !value.startsWith('../') && !isAbsolute(value);
}

// Next's filePathMap points into the build checkout. Move that closure into the output, so
// the upload job needs neither a checkout nor dependencies and cannot read paths outside it.
export async function packagePrebuilt(directory) {
    const root = await realpath(resolve(directory));
    const output = resolve(root, '.vercel/output');
    const configs = (await readdir(resolve(output, 'functions'), { recursive: true }))
        .filter(name => name.endsWith('/.vc-config.json'));
    const copied = new Set();
    const links = [];
    for (const name of configs) {
        const path = resolve(output, 'functions', name);
        const config = JSON.parse(await readFile(path, 'utf8'));
        if (!config.filePathMap) continue;
        const packaged = {};
        for (const [destination, source] of Object.entries(config.filePathMap)) {
            // Next traces this setup example; it is not a runtime dependency or deployable environment.
            if (source === 'apps/web/.env.example') continue;
            safePath(source); safePath(destination);
            if (source.startsWith(`${prefix}/`)) {
                if (!inside(output, await realpath(resolve(root, source)))) throw new Error('Prebuilt dependency escapes output.');
                packaged[destination] = source;
                continue;
            }
            const target = `${prefix}/${source}`;
            if (!copied.has(source)) {
                const original = resolve(root, source);
                if (!inside(root, await realpath(original))) throw new Error('Prebuilt dependency escapes checkout.');
                const stat = await lstat(original);
                const path = resolve(root, target);
                await mkdir(dirname(path), { recursive: true });
                if (stat.isSymbolicLink()) {
                    const link = await readlink(original);
                    if (isAbsolute(link) || !inside(root, resolve(dirname(original), link))) throw new Error('Invalid prebuilt dependency link.');
                    await symlink(link, path);
                    links.push(path);
                } else if (stat.isFile()) await copyFile(original, path);
                else throw new Error('Unsupported prebuilt dependency type.');
                copied.add(source);
            }
            packaged[destination] = target;
        }
        config.filePathMap = packaged;
        await writeFile(path, JSON.stringify(config));
    }
    for (const path of links) {
        if (!inside(resolve(root, prefix), await realpath(path))) throw new Error('Prebuilt dependency link escapes packaged closure.');
    }
    console.info(`Packaged ${copied.size} dependency paths inside the prebuilt output.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    await packagePrebuilt(process.cwd());
