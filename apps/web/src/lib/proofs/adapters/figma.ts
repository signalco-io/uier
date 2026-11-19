import { z } from 'zod';
import { imageAdapter } from './image';
import { ProofSourceError, type ProofSourceAdapter } from '../sourceTypes';

export const figmaSourceType = 'application/vnd.uier.figma-snapshot+json';
export const figmaId = z.string().regex(/^\d{1,12}:\d{1,12}(?:;\d{1,12}:\d{1,12}){0,2}$/);
export const figmaFileKey = z.string().regex(/^[a-zA-Z0-9]{8,80}$/);
export const maxFigmaFrames = 20;
export const figmaSnapshot = z.strictObject({
    key: figmaFileKey,
    selectedIds: z.array(figmaId).min(1).max(maxFigmaFrames),
    frames: z.array(z.strictObject({
        id: figmaId, name: z.string().min(1).max(140), png: z.string().min(12).regex(/^[A-Za-z0-9+/]+={0,2}$/)
    })).min(1).max(maxFigmaFrames),
    changes: z.strictObject({
        added: z.array(figmaId).max(maxFigmaFrames), removed: z.array(figmaId).max(maxFigmaFrames),
        renamed: z.array(z.strictObject({ id: figmaId, from: z.string().max(140), to: z.string().max(140) })).max(maxFigmaFrames)
    })
});
const designUrl = (key: string) => `https://www.figma.com/design/${key}/`;

export const figmaAdapter: ProofSourceAdapter = {
    format: 'figma', contentTypes: [figmaSourceType],
    async ingest({ bytes, signal }) {
        let snapshot;
        try { snapshot = figmaSnapshot.parse(JSON.parse(bytes.toString('utf8'))); }
        catch { throw new ProofSourceError('The imported Figma snapshot is invalid.'); }
        const url = designUrl(snapshot.key);
        const surfaces = [];
        const artifacts = [];
        for (const frame of snapshot.frames) {
            const id = `frame-${frame.id.replace(/:/g, '-').replace(/;/g, '_')}`;
            const image = await imageAdapter.ingest({ bytes: Buffer.from(frame.png, 'base64'), contentType: 'image/png', filename: 'frame.png', signal });
            surfaces.push({ ...image.manifest.surfaces[0]!, id, artifactId: id, label: frame.name,
                sourceUrl: `${url}?node-id=${encodeURIComponent(frame.id)}` });
            artifacts.push({ ...image.artifacts[0]!, id });
        }
        return { manifest: { format: 'figma', surfaces, figma: { url, selectedIds: snapshot.selectedIds, changes: snapshot.changes } }, artifacts };
    }
};
