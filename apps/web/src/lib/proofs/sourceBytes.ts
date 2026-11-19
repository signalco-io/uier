import { apiErrors } from '../comments/http';

export async function readProofBytes(body: ReadableStream<Uint8Array> | null, max: number) {
    if (!body) return Buffer.alloc(0);
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const part = await reader.read();
            if (part.done) return Buffer.concat(chunks, size);
            size += part.value.length;
            if (size > max) {
                await reader.cancel().catch(() => undefined);
                throw apiErrors.tooLarge(max);
            }
            chunks.push(part.value);
        }
    } finally { reader.releaseLock(); }
}
