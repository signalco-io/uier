import { expect, test } from '@playwright/test';
import { browserKind, browserKinds, browserMarks, osKind, osKinds, osMarks } from '@uier/toolbar/devices';

test('browser names choose their mark; anything else gets the generic one', () => {
    const cases: [string | undefined, ReturnType<typeof browserKind>][] = [
        // What the toolbar records from client hint brands
        ['Google Chrome (131)', 'chrome'],
        ['Chromium (123)', 'chrome'],
        ['HeadlessChrome (131)', 'chrome'],
        ['Microsoft Edge (156)', 'edge'],
        ['Opera (114)', 'opera'],
        ['Opera GX (114)', 'opera'],
        ['Brave (131)', 'brave'],
        ['Samsung Internet (27)', 'samsung'],
        ['Vivaldi (7)', 'vivaldi'],
        // What the toolbar parses from the user-agent string (`describeDevice`)
        ['Safari (18.1)', 'safari'],
        ['Headless Chrome (131)', 'chrome'],
        ['Opera Mini (9)', 'opera'],
        ['DuckDuckGo (7)', 'duckduckgo'],
        ['Facebook in-app browser (491)', 'facebook'],
        ['Instagram in-app browser (337)', 'instagram'],
        ['Android WebView (131)', 'browser'],
        ['In-app browser', 'browser'],
        ['Yandex Browser (24)', 'browser'],
        // Names without a version, or from browsers that may report themselves one day
        ['Firefox', 'firefox'],
        ['Mozilla Firefox (133)', 'firefox'],
        ['Safari (18)', 'safari'],
        ['Mobile Safari', 'safari'],
        ['edge', 'edge'],
        // Names that only look close
        ['Example Browser (123)', 'browser'],
        ['Edgewood', 'browser'],
        ['', 'browser'],
        [undefined, 'browser']
    ];
    for (const [name, kind] of cases) expect(browserKind(name), String(name)).toBe(kind);
});

test('operating system names choose their mark; anything else gets the generic one', () => {
    const cases: [string | undefined, ReturnType<typeof osKind>][] = [
        // Client hint platforms
        ['Windows', 'windows'],
        ['macOS', 'macos'],
        ['Linux', 'linux'],
        ['Android', 'android'],
        ['Chrome OS', 'chromeos'],
        ['Chromium OS', 'chromeos'],
        ['ChromeOS', 'chromeos'],
        ['iOS', 'ios'],
        ['iPadOS', 'ios'],
        ['Mac OS X', 'macos'],
        ['Win32', 'windows'],
        // With the versions the toolbar now records
        ['Windows 11', 'windows'],
        ['macOS 15.1', 'macos'],
        ['iOS 18.1', 'ios'],
        ['iPadOS 17.5', 'ios'],
        ['Android 14', 'android'],
        ['Ubuntu', 'ubuntu'],
        ['Fedora', 'fedora'],
        ['HarmonyOS', 'harmonyos'],
        ['FreeBSD', 'freebsd'],
        ['KaiOS 2.5', 'kaios'],
        // Recognised systems without a mark of their own
        ['OpenBSD', 'os'],
        ['NetBSD', 'os'],
        ['Tizen 6.0', 'os'],
        ['webOS', 'os'],
        // Unknown and unsupported systems keep the generic mark
        ['Fuchsia', 'os'],
        ['Unknown', 'os'],
        ['Example OS', 'os'],
        ['Kosmos', 'os'],
        ['', 'os'],
        [undefined, 'os']
    ];
    for (const [name, kind] of cases) expect(osKind(name), String(name)).toBe(kind);
});

test('every kind has a one-colour mark', () => {
    for (const mark of [...browserKinds.map(k => browserMarks[k]), ...osKinds.map(k => osMarks[k])]) {
        expect(mark.viewBox).toMatch(/^0 0 (16|24) (16|24)$/);
        expect(mark.paths.length).toBeGreaterThan(0);
        for (const d of mark.paths) expect(d).toMatch(/^[Mm][\d.\s,MmLlHhVvCcSsQqTtAaZz-]+$/);
    }
});
