import { CommentDeviceInfo, CommentDeviceSize } from '../@types/Comments';
import { describeDevice, pageLanguageTag, type ClientHints } from '../../devices';

type NavigatorUserAgentData = ClientHints & {
    getHighEntropyValues?: (hints: string[]) => Promise<ClientHints>;
};

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function getDeviceSize(): CommentDeviceSize {
    return window.innerWidth >= 1024
        ? 'desktop'
        : (window.innerWidth >= 768 ? 'tablet' : 'mobile');
}

function userAgentData() {
    return (navigator as Navigator & { userAgentData?: NavigatorUserAgentData }).userAgentData;
}

let highEntropy: Promise<ClientHints | undefined> | undefined;
let highEntropyValues: ClientHints | undefined;

/**
 * Chromium's high-entropy client hints, asked once when feedback first starts: only the real system
 * version (`platformVersion`; the user-agent string freezes it) and a phone's `model`. Not the full
 * browser version, the architecture or the form factors: they add nothing to a reproduction.
 */
function loadHighEntropy(data: NavigatorUserAgentData) {
    highEntropy ??= (async () => {
        try {
            const values = await data.getHighEntropyValues!(['platformVersion', 'model']);
            highEntropyValues = { platformVersion: values.platformVersion, model: values.model };
        } catch { /* Not allowed or not supported: the low-entropy names stay */ }
        return highEntropyValues;
    })();
    return highEntropy;
}

function names(values: ClientHints | undefined) {
    const data = userAgentData();
    return describeDevice({
        userAgent: navigator.userAgent,
        touchPoints: navigator.maxTouchPoints,
        hints: data && { brands: data.brands, platform: data.platform, mobile: data.mobile, ...values }
    });
}

function matches(query: string) {
    try {
        return window.matchMedia(query).matches;
    } catch {
        return undefined;
    }
}

/** Settings that change how the page looks or behaves, from the same media queries the page's CSS reads */
function preferences(): Pick<CommentDeviceInfo, 'input' | 'colorScheme' | 'reducedMotion' | 'pageLanguage'> {
    const input = matches('(pointer: coarse)') ? 'touch' : matches('(pointer: fine)') ? 'mouse' : undefined;
    const colorScheme = matches('(prefers-color-scheme: dark)') ? 'dark' : matches('(prefers-color-scheme: light)') ? 'light' : undefined;
    return { input, colorScheme, reducedMotion: matches('(prefers-reduced-motion: reduce)'), pageLanguage: pageLanguageTag(document.documentElement.lang) };
}

/**
 * The device a comment is left from, read when feedback starts: screen size, viewport, pixel ratio,
 * browser and system names (`describeDevice`: parsed from the user-agent string and client hints,
 * which only Chromium sends), a phone's model, the primary input, colour scheme, reduced motion and
 * the page's language. Never the user-agent string itself, fonts, the GPU, the time zone or anything
 * else that tells one person from another rather than helping to reproduce what they saw.
 */
export function getDeviceInfo(): CommentDeviceInfo {
    const data = userAgentData();
    if (data?.getHighEntropyValues) void loadHighEntropy(data);
    return {
        capturedAt: new Date().toISOString(),
        size: getDeviceSize(),
        windowSize: [
            clamp(Math.round(window.innerWidth), 0, 20000),
            clamp(Math.round(window.innerHeight), 0, 20000)
        ],
        pixelRatio: clamp(window.devicePixelRatio, 0, 10),
        ...names(highEntropyValues),
        ...preferences()
    };
}

/**
 * The device with the high-entropy names once Chromium has given them (a moment after the first
 * feedback starts), waiting at most a second; before a comment is sent.
 */
export async function completeDeviceInfo(device: CommentDeviceInfo): Promise<CommentDeviceInfo> {
    const data = userAgentData();
    if (!data?.getHighEntropyValues) return device;
    const values = await Promise.race([loadHighEntropy(data), new Promise<undefined>(resolve => setTimeout(resolve, 1000))]);
    return values ? { ...device, ...names(values) } : device;
}
