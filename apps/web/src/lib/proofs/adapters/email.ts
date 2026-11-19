import PostalMime from 'postal-mime';
import sanitizeHtml from 'sanitize-html';
import { imageAdapter } from './image';
import { ProofSourceError, type ProofSourceAdapter } from '../sourceTypes';

const maxBody = 2 * 1024 * 1024;
const cidKey = (value: string) => value.trim().replace(/^<|>$/g, '');
const oneLine = (value: string | undefined, max: number) => value?.replace(/\s+/g, ' ').trim().slice(0, max) || undefined;

export const emailAdapter: ProofSourceAdapter = {
    format: 'email', contentTypes: ['message/rfc822'],
    async ingest({ bytes, signal }) {
        let message;
        try {
            message = await PostalMime.parse(bytes, { maxPartCount: 160, maxNestingDepth: 16,
                maxHeadersSize: 128 * 1024, maxRfc822NestingDepth: 0 });
        } catch {
            throw new ProofSourceError('The email exceeds supported MIME limits or could not be read.');
        }
        signal.throwIfAborted();
        if (!message.headers.some(header => ['from', 'to', 'subject', 'date', 'message-id', 'mime-version'].includes(header.key))
            || (!message.html?.trim() && !message.text?.trim())) throw new ProofSourceError('Choose a valid email with a text or HTML body.');
        if (Buffer.byteLength(message.html ?? '') + Buffer.byteLength(message.text ?? '') > maxBody)
            throw new ProofSourceError('This email body exceeds 2 MB.');
        const images = new Map<string, string>();
        let imageBytes = 0;
        for (const attachment of message.attachments) {
            if (!attachment.contentId || typeof attachment.content === 'string' || imageBytes >= 512 * 1024 || images.size >= 16
                || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.mimeType)) continue;
            const data = new Uint8Array(attachment.content);
            if (data.byteLength > 512 * 1024) continue;
            try {
                const preview = await imageAdapter.ingest({ bytes: Buffer.from(data), contentType: attachment.mimeType, filename: 'inline-image', signal });
                const image = preview.artifacts[0]!.bytes;
                if (imageBytes + image.length > 512 * 1024) continue;
                imageBytes += image.length;
                images.set(cidKey(attachment.contentId), `data:image/webp;base64,${image.toString('base64')}`);
            } catch (error) { if (signal.aborted) throw error; }
        }
        const links = new Set<string>();
        const html = message.html ? sanitizeHtml(message.html, {
            allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'center', 'font', 'col', 'colgroup'],
            allowedAttributes: {
                '*': ['style', 'class', 'id', 'align', 'valign', 'width', 'height', 'bgcolor', 'role', 'aria-label', 'lang', 'dir'],
                a: ['href'], img: ['src', 'alt'], table: ['cellpadding', 'cellspacing', 'border'], td: ['colspan', 'rowspan'],
                th: ['colspan', 'rowspan', 'scope'], font: ['color', 'face', 'size'], col: ['span']
            },
            allowedSchemes: ['http', 'https', 'mailto'], allowedSchemesByTag: { img: ['data'] }, allowProtocolRelative: false,
            transformTags: {
                a: (tagName, { href, ...attribs }) => {
                    try {
                        const url = new URL(href ?? '');
                        if (['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password
                            && url.href.length <= 2048 && links.size < 100) links.add(url.href);
                    } catch { /* Keep the link text. */ }
                    // A review exposes the destination as text, without navigating or tracking clicks.
                    return { tagName, attribs };
                },
                img: (tagName, { src, ...attribs }) => {
                    const embedded = src?.startsWith('cid:') ? images.get(cidKey(src.slice(4))) : undefined;
                    return { tagName, attribs: embedded ? { ...attribs, src: embedded } : attribs };
                },
                '*': (tagName, attribs) => {
                    if (attribs.style && /url\s*\(|[@\\]/i.test(attribs.style)) delete attribs.style;
                    return { tagName, attribs };
                }
            }
        }) : '';
        const fallback = sanitizeHtml(html.replace(/<\/(?:p|li|div|td|tr|h[1-6])>|<br\s*\/?>/gi, '\n'), { allowedTags: [], allowedAttributes: {} });
        const text = message.text?.trim() || decodeText(fallback).trim();
        if (!html.trim() && !text) throw new ProofSourceError('This email has no reviewable body.');
        const from = message.from ?? message.sender;
        const sender = oneLine(from?.name && from.address ? `${from.name} <${from.address}>` : from?.address ?? from?.name, 320);
        const preheader = oneLine(message.headers.find(header => ['x-preheader', 'preheader'].includes(header.key))?.value
            ?? text.split('\n').find(line => line.trim()), 240);
        return {
            manifest: { format: 'email', surfaces: [{ id: 'email', artifactId: html ? 'email-html' : 'email-text', height: 650 }],
                email: { subject: oneLine(message.subject, 320), sender, preheader, plainTextArtifactId: 'email-text', links: [...links] } },
            artifacts: [{ id: 'email-text', contentType: 'text/plain', bytes: Buffer.from(text || ' ') },
                ...(html ? [{ id: 'email-html', contentType: 'text/html', bytes: Buffer.from(html) }] : [])]
        };
    }
};

function decodeText(text: string) {
    // sanitize-html escapes text on output. Decode entities once for the plain-text reader.
    return text.replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, entity: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x27': "'" })[entity] ?? '');
}
