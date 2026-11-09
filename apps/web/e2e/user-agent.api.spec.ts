import { expect, test } from '@playwright/test';
import { browserKind, describeDevice, deviceSettings, osKind, pageLanguageTag, parseUserAgent } from '@uier/toolbar/devices';

// Real user-agent strings, as the browsers send them. The toolbar parses them in the reviewer's
// browser (`getDeviceInfo`) and sends only the names; `[browser, os, model]` is what a comment stores.
const desktop: [string, string | undefined, string | undefined][] = [
    // Chrome, Edge, Opera, Vivaldi and Yandex on Windows: NT 10.0 is Windows 10 and 11, so no version
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Google Chrome (131)', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', 'Microsoft Edge (131)', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0', 'Opera (115)', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36', 'Yandex Browser (24)', 'Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox (133)', 'Windows'],
    // Older Windows versions are not frozen
    ['Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0', 'Firefox (115)', 'Windows 7'],
    // Every macOS browser says 10_15_7 or 10.15, whatever the version: none is shown
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15', 'Safari (18.1)', 'macOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Google Chrome (131)', 'macOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox (133)', 'macOS'],
    // Linux, its distributions, Chrome OS (a frozen build) and the BSDs
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Vivaldi/7.0.3495.18', 'Vivaldi (7)', 'Linux'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox (133)', 'Linux'],
    ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox (133)', 'Ubuntu'],
    ['Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox (133)', 'Fedora'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Google Chrome (131)', 'Chrome OS'],
    ['Mozilla/5.0 (X11; FreeBSD amd64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox (133)', 'FreeBSD'],
    ['Mozilla/5.0 (X11; OpenBSD amd64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox (128)', 'OpenBSD'],
    ['Mozilla/5.0 (X11; NetBSD amd64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox (128)', 'NetBSD'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36', 'Headless Chrome (131)', 'Linux']
];

const mobile: [string, string | undefined, string | undefined, string?][] = [
    // iOS: Safari's version is the system's (Safari 26 keeps the string at 18_6)
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari (18.1)', 'iOS 18.1'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', 'Safari (26.0)', 'iOS 26.0'],
    // Other iOS browsers: their own name and version on WebKit, the string's system version unless it may be frozen
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1', 'Google Chrome (131)', 'iOS 18.1'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1', 'Google Chrome (131)', 'iOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15', 'Firefox (133)', 'iOS 17.5'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/131.0.2903.92 Version/18.0 Mobile/15E148 Safari/604.1', 'Microsoft Edge (131)', 'iOS 18.1'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15', 'DuckDuckGo (7)', 'iOS 17.5'],
    // In-app browsers
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/491.0.0.39.76;FBBV/650000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]', 'Facebook in-app browser (491)', 'iOS 17.5'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 615116010)', 'Instagram in-app browser (337)', 'iOS 17.5'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', 'In-app browser', 'iOS 17.5'],
    ['Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/473.0.0.40.109;]', 'Facebook in-app browser (473)', 'Android 14', 'SM-S911B'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Mobile Safari/537.36', 'Android WebView (131)', 'Android 14', 'Pixel 8'],
    // iPadOS
    ['Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', 'Safari (17.5)', 'iPadOS 17.5'],
    // Android: Chrome's reduced string ("Android 10; K") freezes the version and hides the model
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'Google Chrome (131)', 'Android'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0', 'Microsoft Edge (131)', 'Android'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36', 'Samsung Internet (27)', 'Android'],
    ['Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 OPR/86.0.0.0', 'Opera (86)', 'Android'],
    ['Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0', 'Firefox (133)', 'Android 14'],
    ['Mozilla/5.0 (Linux; U; Android 11; en-US; RMX2193 Build/RP1A.200720.011) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/13.4.0.1306 Mobile Safari/537.36', 'UC Browser (13)', 'Android 11', 'RMX2193'],
    // HarmonyOS (older phones also say Android), KaiOS, Tizen and webOS
    ['Mozilla/5.0 (Linux; Android 12; HarmonyOS; ANA-AN00; HMSCore 6.6.0.352) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/13.0.5.303 Mobile Safari/537.36', 'Huawei Browser (13)', 'HarmonyOS'],
    ['Mozilla/5.0 (Phone; OpenHarmony 4.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile', 'ArkWeb (4)', 'HarmonyOS'],
    ['Mozilla/5.0 (Mobile; Nokia_8110_4G; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5', 'Firefox (48)', 'KaiOS 2.5'],
    ['Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.0 TV Safari/537.36', undefined, 'Tizen 6.0'],
    ['Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.128 Safari/537.36 WebAppManager', 'Google Chrome (94)', 'webOS']
];

test('every browser and system names itself without client hints', () => {
    for (const [userAgent, browser, os, model] of [...desktop, ...mobile]) {
        const names = describeDevice({ userAgent });
        expect(names, userAgent).toEqual({ browser, os, model });
    }
});

test('the parsed names choose the marks the views show', () => {
    const marks = [...desktop, ...mobile].map(([userAgent]) => {
        const { browser, os } = describeDevice({ userAgent });
        return `${browserKind(browser)}/${osKind(os)}`;
    });
    expect(new Set(marks)).toEqual(new Set([
        'chrome/windows', 'edge/windows', 'opera/windows', 'browser/windows', 'firefox/windows', 'safari/macos', 'chrome/macos', 'firefox/macos',
        'vivaldi/linux', 'firefox/linux', 'firefox/ubuntu', 'firefox/fedora', 'chrome/chromeos', 'firefox/freebsd', 'firefox/os', 'chrome/linux',
        'safari/ios', 'chrome/ios', 'firefox/ios', 'edge/ios', 'duckduckgo/ios', 'facebook/ios', 'instagram/ios', 'browser/ios', 'facebook/android',
        'chrome/android', 'edge/android', 'samsung/android', 'opera/android', 'firefox/android', 'browser/android', 'browser/harmonyos',
        'firefox/kaios', 'browser/os', 'chrome/os'
    ]));
});

test('an iPad asking for the desktop site is iPadOS, a Mac has no touch screen', () => {
    const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
    expect(describeDevice({ userAgent, touchPoints: 5 })).toMatchObject({ browser: 'Safari (18.1)', os: 'iPadOS 18.1' });
    expect(describeDevice({ userAgent, touchPoints: 0 })).toMatchObject({ browser: 'Safari (18.1)', os: 'macOS' });
    // Chrome on an iPad: iPadOS, without a version (only Safari's is the system's)
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Version/18.0 Safari/605.1.15';
    expect(describeDevice({ userAgent: chrome, touchPoints: 5 })).toMatchObject({ browser: 'Google Chrome (131)', os: 'iPadOS' });
});

test('client hints name Chromium browsers; high-entropy hints give the real system version and model', () => {
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const grease = { brand: 'Not_A Brand', version: '24' };
    const brave = { brands: [grease, { brand: 'Chromium', version: '131' }, { brand: 'Brave', version: '131' }], platform: 'Windows' };
    // Brave's string is Chrome's; only the hints tell them apart
    expect(describeDevice({ userAgent: windows, hints: brave })).toEqual({ browser: 'Brave (131)', os: 'Windows' });
    // Windows 11 reports 13 and later, Windows 10 1 to 10
    expect(describeDevice({ userAgent: windows, hints: { ...brave, platformVersion: '15.0.0' } }).os).toBe('Windows 11');
    expect(describeDevice({ userAgent: windows, hints: { ...brave, platformVersion: '10.0.0' } }).os).toBe('Windows 10');
    expect(describeDevice({ userAgent: windows, hints: { ...brave, platformVersion: '0.3.0' } }).os).toBe('Windows 8.1');
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const chrome = [grease, { brand: 'Chromium', version: '131' }, { brand: 'Google Chrome', version: '131' }];
    expect(describeDevice({ userAgent: mac, hints: { brands: chrome, platform: 'macOS', platformVersion: '15.1.0' } })).toEqual({ browser: 'Google Chrome (131)', os: 'macOS 15.1' });
    const android = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
    expect(describeDevice({ userAgent: android, hints: { brands: chrome, platform: 'Android', mobile: true } })).toEqual({ browser: 'Google Chrome (131)', os: 'Android' });
    expect(describeDevice({ userAgent: android, hints: { brands: chrome, platform: 'Android', mobile: true, platformVersion: '14.0.0', model: 'Pixel 8' } }))
        .toEqual({ browser: 'Google Chrome (131)', os: 'Android 14', model: 'Pixel 8' });
    // A model from the string belongs to its system only
    const pixel = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.6778.39 Mobile Safari/537.36';
    expect(describeDevice({ userAgent: pixel, hints: { brands: chrome, platform: 'Android', mobile: true } }).model).toBe('Pixel 8');
    expect(describeDevice({ userAgent: pixel, hints: { brands: chrome, platform: 'macOS' } }).model).toBeUndefined();
    // Linux's platform version is the kernel and Chrome OS's a build: not shown
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    expect(describeDevice({ userAgent: linux, hints: { brands: chrome, platform: 'Linux', platformVersion: '6.8.0' } }).os).toBe('Linux');
    expect(describeDevice({ userAgent: linux, hints: { brands: chrome, platform: 'Chromium OS', platformVersion: '16002.44.0' } }).os).toBe('Chrome OS');
    // Unknown or malformed hints fall back to the string
    expect(describeDevice({ userAgent: mac, hints: { brands: [grease], platform: 'Unknown', platformVersion: 'soon' } })).toEqual({ browser: 'Google Chrome (131)', os: 'macOS' });
    // An in-app browser's web view says Android WebView in the hints; the string names the app
    const facebook = mobile.find(([userAgent]) => userAgent.includes('FB4A'))![0];
    expect(describeDevice({ userAgent: facebook, hints: { brands: [grease, { brand: 'Android WebView', version: '126' }], platform: 'Android', mobile: true } }).browser)
        .toBe('Facebook in-app browser (473)');
    // What the browser reports is bounded text
    expect(describeDevice({ hints: { brands: [{ brand: `Very​${'Long'.repeat(30)}`, version: '1' }], platform: 'Windows', model: ' ‮Model\n' } }))
        .toEqual({ browser: `Very ${'Long'.repeat(30)}`.slice(0, 64), os: 'Windows', model: 'Model' });
});

test('anything else names nothing rather than guessing', () => {
    for (const userAgent of ['', 'curl/8.4.0', 'Something else entirely', 'Mozilla/5.0'])
        expect(parseUserAgent(userAgent), userAgent).toEqual({});
    expect(describeDevice({})).toEqual({ browser: undefined, os: undefined, model: undefined });
});

test('the page language keeps language, script and region only', () => {
    const cases: [string | undefined, string | undefined][] = [
        ['en-gb', 'en-GB'], ['EN', 'en'], ['zh-hant-tw', 'zh-Hant-TW'], ['es-419', 'es-419'], ['de-DE-u-co-phonebk', 'de-DE'],
        ['en-x-private', 'en'], ['x-klingon', undefined], ['und', undefined], ['en_US', undefined], ['not a tag', undefined], ['', undefined], [undefined, undefined]
    ];
    for (const [value, tag] of cases) expect(pageLanguageTag(value), String(value)).toBe(tag);
});

test('recorded settings are listed in one order, unrecorded ones left out', () => {
    expect(deviceSettings({})).toEqual([]);
    expect(deviceSettings({ pageLanguage: 'en-GB', reducedMotion: false, colorScheme: 'dark', input: 'touch', model: 'Pixel 8' })).toEqual([
        ['Model', 'Pixel 8'], ['Input', 'Touch'], ['Colour scheme', 'Dark'], ['Reduced motion', 'Off'], ['Page language', 'en-GB']
    ]);
    expect(deviceSettings({ input: 'mouse', colorScheme: 'light', reducedMotion: true })).toEqual([['Input', 'Mouse or trackpad'], ['Colour scheme', 'Light'], ['Reduced motion', 'On']]);
});
