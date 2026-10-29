import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

/** Mask dotenv values, including multiline secrets, before any build or worker logs. */
export function maskEnvironmentFile(path, write = value => process.stdout.write(value)) {
    const values = Object.values(parseEnv(readFileSync(path, 'utf8')));
    for (const value of values) {
        if (!value) continue;
        // GitHub workflow command data must escape percent signs before CR/LF.
        const escaped = value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
        write(`::add-mask::${escaped}\n`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (!process.argv[2]) throw new Error('Expected an environment file path.');
    maskEnvironmentFile(process.argv[2]);
}
