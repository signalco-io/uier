import { CommentDeviceInfo, CommentDeviceSize } from '../@types/Comments';

type NavigatorUserAgentData = {
    platform?: string;
    brands?: { brand: string; version: string }[];
};

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function getDeviceSize(): CommentDeviceSize {
    return window.innerWidth >= 1024
        ? 'desktop'
        : (window.innerWidth >= 768 ? 'tablet' : 'mobile');
}

/** Coarse device info stored with a new comment (only `size` is shown to other visitors) */
export function getDeviceInfo(): CommentDeviceInfo {
    const userAgentData = (navigator as Navigator & { userAgentData?: NavigatorUserAgentData }).userAgentData;
    // Skip the GREASE brand ("Not A;Brand") and prefer the specific browser over "Chromium"
    const brands = (userAgentData?.brands ?? []).filter(b => !/not.?a.?brand/i.test(b.brand));
    const brand = brands.find(b => b.brand !== 'Chromium') ?? brands[0];

    return {
        size: getDeviceSize(),
        windowSize: [
            clamp(Math.round(window.innerWidth), 0, 20000),
            clamp(Math.round(window.innerHeight), 0, 20000)
        ],
        pixelRatio: clamp(window.devicePixelRatio, 0, 10),
        os: userAgentData?.platform?.slice(0, 64) || undefined,
        browser: brand ? `${brand.brand} (${brand.version})`.slice(0, 64) : undefined
    };
}
