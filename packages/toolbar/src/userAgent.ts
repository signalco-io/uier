/**
 * The browser and operating system a comment is left from, read from what the browser says about
 * itself (`getDeviceInfo`): the user-agent string, Chromium's client hints and the touch point count.
 * Pure, so the server tests can run it. Only the parsed, bounded names leave the page; the user-agent
 * string itself is never sent.
 *
 * A version is written only when the browser reports a real one. Frozen values are left out: every
 * current macOS browser says 10_15_7 (or 10.15), Windows 10 and 11 both say NT 10.0, Chrome's reduced
 * Android string says "Android 10; K" and Chrome OS a fixed build, and Safari 26 keeps the iOS string at
 * 18_6. Chromium's high-entropy hints (`platformVersion`) give the real system version, and on iOS
 * Safari's own version is the system's.
 */

export type ClientHints = {
    brands?: readonly { brand: string; version: string }[];
    platform?: string;
    mobile?: boolean;
    /** High-entropy hints (`getHighEntropyValues`), when the browser gave them */
    platformVersion?: string;
    model?: string;
};

export type NameAndVersion = { name: string; version?: string };
export type ParsedUserAgent = { browser?: NameAndVersion; os?: NameAndVersion; model?: string };
/** What a comment stores: "Safari (18.1)", "iOS 18.1", "Pixel 8" */
export type DeviceNames = { browser?: string; os?: string; model?: string };

export const MAX_DEVICE_NAME_LENGTH = 64;

type BrowserRule = { name: string; test: RegExp; version?: RegExp };

/**
 * The first matching rule wins. Browsers keep the tokens of the engines and browsers they imitate
 * (Edge says Chrome and Safari too), so the specific ones come first; in-app browsers wrap a system
 * web view and come before everything.
 */
const browserRules: BrowserRule[] = [
    { name: 'Facebook in-app browser', test: /\bFB(?:AN|AV|_IAB)\//, version: /\bFBAV\/(\d+)/ },
    { name: 'Instagram in-app browser', test: /\bInstagram (\d+)/ },
    { name: 'Microsoft Edge', test: /\bEdg(?:e|A|iOS)?\/(\d+)/ },
    { name: 'Opera Mini', test: /\bOpera Mini\/(\d+)/ },
    { name: 'Opera', test: /\b(?:OPR|OPT|OPiOS)\/(\d+)/ },
    { name: 'Samsung Internet', test: /\bSamsungBrowser\/(\d+)/ },
    { name: 'Yandex Browser', test: /\bYaBrowser\/(\d+)/ },
    { name: 'UC Browser', test: /\bUCBrowser\/(\d+)/ },
    { name: 'Huawei Browser', test: /\bHuaweiBrowser\/(\d+)/ },
    { name: 'DuckDuckGo', test: /\b(?:DuckDuckGo|Ddg)\/(\d+)/ },
    { name: 'Vivaldi', test: /\bVivaldi\/(\d+)/ },
    { name: 'Brave', test: /\bBrave\/(\d+)/ },
    { name: 'Amazon Silk', test: /\bSilk\/(\d+)/ },
    { name: 'Naver Whale', test: /\bWhale\/(\d+)/ },
    { name: 'Firefox', test: /\b(?:Firefox|FxiOS)\/(\d+)/ },
    { name: 'Headless Chrome', test: /\bHeadlessChrome\/(\d+)/ },
    { name: 'ArkWeb', test: /\bArkWeb\/(\d+)/ },
    { name: 'Android WebView', test: /; wv\).*\bChrome\/(\d+)/ },
    { name: 'Chromium', test: /\bChromium\/(\d+)/ },
    { name: 'Google Chrome', test: /\b(?:CriOS|Chrome)\/(\d+)/ },
    // Safari's own version, with the minor one: Safari ships features in point releases
    { name: 'Safari', test: /\bVersion\/(\d+(?:\.\d+)?).*\bSafari\// },
    // An app's WebKit view on iOS: no Safari token and no version of its own
    { name: 'In-app browser', test: /\b(?:iPhone|iPad|iPod)\b.*\bAppleWebKit\/[\d.]+(?!.*\bSafari\/)/ }
];

function parseBrowser(userAgent: string): NameAndVersion | undefined {
    for (const rule of browserRules) {
        const match = rule.test.exec(userAgent);
        if (!match) continue;
        const version = rule.version ? rule.version.exec(userAgent)?.[1] : match[1];
        return { name: rule.name, ...(version ? { version } : {}) };
    }
    return undefined;
}

/** Windows NT versions that are not frozen; NT 10.0 is Windows 10 and 11 */
const windowsVersions: Record<string, string> = { '6.1': '7', '6.2': '8', '6.3': '8.1' };

/** Safari 26 and later keep iOS at 18_6 in the user-agent string */
const frozenIos = '18.6';

/** "18_1_1" → "18.1"; "18_0" → "18.0" */
function appleVersion(major: string, minor: string | undefined) {
    return `${major}.${minor ?? '0'}`;
}

/**
 * Android's model, from the tokens after the version: "Pixel 8 Build/AP2A" in old and web view strings,
 * after a locale in some ("en-US; RMX2193"); never a placeholder ("K", "Mobile", "wv").
 */
function androidModel(tokens: string[]) {
    for (const token of tokens) {
        const model = token.replace(/\s+Build\/.*$/, '').trim();
        if (!model || /^(?:K|U|Mobile|Tablet|wv|Linux|Android)$/i.test(model) || /^[a-z]{2,3}[-_][a-z]{2}$/i.test(model) || /^rv:/.test(model))
            continue;
        return /^[\p{L}\p{N}][\p{L}\p{N} ._+()-]{0,47}$/u.test(model) ? model : undefined;
    }
    return undefined;
}

function parseOs(userAgent: string, touchPoints: number, browser: NameAndVersion | undefined): { os?: NameAndVersion; model?: string } {
    // Systems that also say Android or Linux come first
    if (/\b(?:HarmonyOS|OpenHarmony)\b/.test(userAgent))
        return { os: { name: 'HarmonyOS' } };
    let match = /\bKAIOS\/(\d+(?:\.\d+)?)/i.exec(userAgent);
    if (match) return { os: { name: 'KaiOS', version: match[1] } };
    match = /\bTizen[ /](\d+(?:\.\d+)?)/.exec(userAgent);
    if (match) return { os: { name: 'Tizen', version: match[1] } };
    if (/\b(?:Web0S|webOS)\b/.test(userAgent))
        return { os: { name: 'webOS' } };

    // On iOS and iPadOS, Safari's version is the system's
    const safari = browser?.name === 'Safari' && browser.version ? browser.version : undefined;
    match = /\b(iPhone|iPod|iPad)\b.*?\bOS (\d+)_(\d+)/.exec(userAgent);
    if (match) {
        const reported = appleVersion(match[2]!, match[3]);
        return { os: { name: match[1] === 'iPad' ? 'iPadOS' : 'iOS', version: safari ?? (reported === frozenIos ? undefined : reported) } };
    }
    if (/\b(?:iPhone|iPod)\b/.test(userAgent)) return { os: { name: 'iOS', ...(safari ? { version: safari } : {}) } };
    if (/\biPad\b/.test(userAgent)) return { os: { name: 'iPadOS', ...(safari ? { version: safari } : {}) } };
    if (/\bMacintosh\b/.test(userAgent)) {
        // iPadOS asks for desktop sites as a Mac; only an iPad has a touch screen
        if (touchPoints > 1) return { os: { name: 'iPadOS', ...(safari ? { version: safari } : {}) } };
        return { os: { name: 'macOS' } };
    }

    match = /\bWindows NT (\d+\.\d+)/.exec(userAgent);
    if (match) {
        const version = windowsVersions[match[1]!];
        return { os: { name: 'Windows', ...(version ? { version } : {}) } };
    }
    if (/\bWindows\b/.test(userAgent)) return { os: { name: 'Windows' } };

    match = /\bAndroid(?: (\d+)(?:\.(\d+))?[^;)]*)?((?:;[^;)]*)*)/.exec(userAgent);
    if (match) {
        const tokens = (match[3] ?? '').split(';').map(token => token.trim()).filter(Boolean);
        const model = androidModel(tokens);
        // Chrome's reduced string: "Android 10; K", whatever the version
        const frozen = tokens[0] === 'K';
        const version = match[1] && !frozen ? `${match[1]}${match[2] && match[2] !== '0' ? `.${match[2]}` : ''}` : undefined;
        return { os: { name: 'Android', ...(version ? { version } : {}) }, ...(model ? { model } : {}) };
    }
    if (/\bCrOS\b/.test(userAgent)) return { os: { name: 'Chrome OS' } };
    for (const name of ['FreeBSD', 'OpenBSD', 'NetBSD', 'Ubuntu', 'Fedora', 'Fuchsia'])
        if (new RegExp(`\\b${name}\\b`).test(userAgent)) return { os: { name } };
    if (/\b(?:Linux|X11)\b/.test(userAgent)) return { os: { name: 'Linux' } };
    return {};
}

/** A user-agent string's browser (name, major version; Safari's with its minor one), system and phone model */
export function parseUserAgent(userAgent: string, touchPoints = 0): ParsedUserAgent {
    const browser = parseBrowser(userAgent);
    const { os, model } = parseOs(userAgent, touchPoints, browser);
    return { ...(browser ? { browser } : {}), ...(os ? { os } : {}), ...(model ? { model } : {}) };
}

/** Text from the browser, bounded, without control or format characters */
function clean(value: string | undefined) {
    const text = value?.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_DEVICE_NAME_LENGTH).trim();
    return text || undefined;
}

/** The brand that names the browser: not the GREASE brand ("Not A;Brand") and, when there is another, not Chromium */
function hintBrowser(hints: ClientHints | undefined): NameAndVersion | undefined {
    const brands = (hints?.brands ?? []).filter(b => typeof b?.brand === 'string' && b.brand.replace(/[^a-z]/gi, '').toLowerCase() !== 'notabrand');
    const brand = brands.find(b => b.brand !== 'Chromium') ?? brands[0];
    if (!brand) return undefined;
    const version = /^\d+/.exec(String(brand.version ?? ''))?.[0];
    return { name: brand.brand, ...(version ? { version } : {}) };
}

/** Client hint platforms, as the user-agent names them */
function hintPlatform(platform: string | undefined) {
    const name = clean(platform);
    if (!name || name === 'Unknown') return undefined;
    return /^chrom(?:e|ium) ?os$/i.test(name) ? 'Chrome OS' : name;
}

/** More specific systems the user-agent string names on a client hint platform */
const refinements: Record<string, readonly string[]> = { Linux: ['Ubuntu', 'Fedora', 'Tizen', 'webOS'], Android: ['HarmonyOS', 'KaiOS'] };

/**
 * The real system version from `platformVersion`: Windows 11 reports 13 and later, Windows 10 1 to 10;
 * macOS and Android their own. Linux (the kernel) and Chrome OS (a build) are left out.
 */
function platformVersion(os: string, value: string | undefined) {
    const match = /^(\d+)\.(\d+)(?:\.\d+)*$/.exec(value?.trim() ?? '');
    if (!match) return undefined;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (os === 'Windows') return major >= 13 ? '11' : major >= 1 ? '10' : ({ 1: '7', 2: '8', 3: '8.1' } as Record<number, string>)[minor];
    if (os === 'macOS') return `${major}.${minor}`;
    if (os === 'Android') return minor ? `${major}.${minor}` : String(major);
    return undefined;
}

/**
 * The names a comment stores: the browser as "Name (version)", like the client hint brands always
 * were, the system as "Name version" and a phone's model. Chromium's client hints name the browser
 * (only they tell Brave from Chrome) unless the string names an in-app browser; the string names
 * everything else.
 */
export function describeDevice({ userAgent = '', touchPoints = 0, hints }: { userAgent?: string; touchPoints?: number; hints?: ClientHints }): DeviceNames {
    const parsed = parseUserAgent(userAgent, touchPoints);
    const inApp = parsed.browser && /in-app/.test(parsed.browser.name);
    const browser = (!inApp && hintBrowser(hints)) || parsed.browser;

    const platform = hintPlatform(hints?.platform);
    let os: NameAndVersion | undefined = parsed.os;
    if (platform && !(parsed.os && refinements[platform]?.includes(parsed.os.name))) {
        const version = platformVersion(platform, hints?.platformVersion) ?? (parsed.os?.name === platform ? parsed.os.version : undefined);
        os = { name: platform, ...(version ? { version } : {}) };
    }

    // The string's model belongs to the system it names, not to one the hints report instead
    const model = clean(hints?.model) ?? (os?.name === parsed.os?.name ? parsed.model : undefined);
    return {
        browser: clean(browser && (browser.version ? `${browser.name} (${browser.version})` : browser.name)),
        os: clean(os && (os.version ? `${os.name} ${os.version}` : os.name)),
        model: clean(model)
    };
}

/** Language, script and region only ("en", "zh-Hant-TW", "es-419"): no private-use or extension subtags */
export const pageLanguagePattern = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/;

/** Labels for the stored settings, shared by the views, the copied details and the feedback packet */
export const deviceInputLabels = { touch: 'Touch', mouse: 'Mouse or trackpad' } as const;
export const colorSchemeLabels = { light: 'Light', dark: 'Dark' } as const;

export type DeviceSettings = {
    model?: string;
    input?: keyof typeof deviceInputLabels;
    colorScheme?: keyof typeof colorSchemeLabels;
    reducedMotion?: boolean;
    pageLanguage?: string;
};

/** The recorded details beyond the browser and system, as label and value in the order every view lists them; older comments have none */
export function deviceSettings(device: DeviceSettings): [label: string, value: string][] {
    const rows: [string, string | undefined][] = [
        ['Model', device.model],
        ['Input', device.input && deviceInputLabels[device.input]],
        ['Colour scheme', device.colorScheme && colorSchemeLabels[device.colorScheme]],
        ['Reduced motion', device.reducedMotion === undefined ? undefined : device.reducedMotion ? 'On' : 'Off'],
        ['Page language', device.pageLanguage]
    ];
    return rows.filter((row): row is [string, string] => !!row[1]);
}

/**
 * The page's language (`<html lang>`) as language, script and region ("en-GB", "zh-Hant-TW"), without
 * private-use or extension subtags; nothing for a value that is not a language tag.
 */
export function pageLanguageTag(value: string | null | undefined) {
    const tag = value?.trim();
    if (!tag || tag.length > 64) return undefined;
    try {
        const locale = new Intl.Locale(Intl.getCanonicalLocales(tag)[0]!);
        const result = [locale.language, locale.script, locale.region].filter(Boolean).join('-');
        return pageLanguagePattern.test(result) && result !== 'und' ? result : undefined;
    } catch {
        return undefined;
    }
}
