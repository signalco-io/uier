import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { kitLicense, kitNoticeTitle } from '../../ui-primitives/src/notice/index.ts';

/** The packaged file with the notices of the software the extension's scripts bundle */
export const noticesFile = 'THIRD-PARTY-NOTICES.txt';

const rule = '-'.repeat(78);

/**
 * The notices esbuild kept at the end of a script (`/*! Bundled license information:`): each a list of
 * bundled files, then the comment those files carry.
 * @param {string} js
 * @returns {{ files: string[], notice: string }[]}
 */
function bundledNotices(js) {
    const start = js.lastIndexOf('/*! Bundled license information:');
    if (start < 0) return [];
    const end = js.indexOf('*/', start);
    const block = js.slice(js.indexOf('\n', start) + 1, end < 0 ? undefined : end);
    return [...block.matchAll(/((?:^\S[^\n]*:\n)+)((?:^ [^\n]*\n?)+)/gm)].map(([, files, notice]) => ({
        files: files.trim().split('\n').map(file => file.replace(/:$/, '')),
        notice: notice.split('\n').map(line => line.replace(/^ {2}/, '')).join('\n').trim()
    }));
}

/**
 * The text of THIRD-PARTY-NOTICES.txt: the UI kit's MIT notice (signalco), then every notice the
 * bundler kept in the packaged scripts, each once with the files that carry it.
 * @param {Record<string, string>} scripts packaged script name to its JavaScript
 */
export function thirdPartyNotices(scripts) {
    /** @type {Map<string, Set<string>>} */
    const notices = new Map();
    for (const js of Object.values(scripts)) {
        for (const { files, notice } of bundledNotices(js)) {
            const carriers = notices.get(notice) ?? new Set();
            for (const file of files) carriers.add(file);
            notices.set(notice, carriers);
        }
    }
    return [
        'Third-party notices',
        '',
        'The uier browser extension includes the software below. The extension itself is under the',
        'license in LICENSE; the packaged Geist fonts are under the license in fonts/LICENSE.txt.',
        '',
        rule,
        kitNoticeTitle,
        '',
        kitLicense.trim(),
        ...[...notices].flatMap(([notice, files]) => ['', rule, [...files].sort().join('\n'), '', notice]),
        ''
    ].join('\n');
}

/**
 * Fails unless a built package carries the notices file with the UI kit's full MIT notice.
 * @param {string} directory the built package (`dist`)
 */
export async function checkPackagedNotices(directory) {
    const text = await readFile(join(directory, noticesFile), 'utf8').catch(() => '');
    assert(text, `Missing packaged file ${noticesFile}`);
    assert(text.includes(kitNoticeTitle) && text.includes(kitLicense.trim()), `${noticesFile} is missing the UI kit's MIT notice (packages/ui-primitives/LICENSE)`);
}
