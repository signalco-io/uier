import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const THREAD_CARD_URI = 'ui://uier/thread-v1.html';
export const THREAD_CARD_MIME = 'text/html;profile=mcp-app';

// Built before Next.js and explicitly traced into /api/mcp. Only the static shell is shared;
// authorized thread data arrives separately through the host's tool result.
export function threadCardHtml(): Promise<string> {
    return readFile(join(process.cwd(), 'dist/mcp/thread.html'), 'utf8');
}
