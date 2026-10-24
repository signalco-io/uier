import type { CommentDeviceSize, CommentItem } from '../@types/Comments';

const sizeLabels: Record<CommentDeviceSize, string> = {
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Mobile'
};

/** "Desktop · 1280×720": the device size and viewport a comment was left from (mono: a machine wrote it) */
export function CommentDeviceMeta({ device }: { device: CommentItem['device'] }) {
    const parts = [
        device?.size ? sizeLabels[device.size] : undefined,
        device?.windowSize ? `${device.windowSize[0]}×${device.windowSize[1]}` : undefined
    ].filter(Boolean);
    if (!parts.length) {
        return null;
    }

    return (
        <p className="m-0 font-mono text-xs tabular-nums text-muted-foreground" title="Device and viewport the comment was left from">
            {parts.join(' · ')}
        </p>
    );
}
