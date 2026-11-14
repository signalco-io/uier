import type { PageFixture } from './types';

// A page whose styles reach the toolbar's shadow root every way they can (packages/toolbar/docs/host-styles.md,
// e2e/host-styles.spec.ts): a root font size for `rem`, text styles the toolbar's host inherits from <body>, rules
// on the host element itself (`body > div`, `*`, its id with `!important`), custom properties, CSS zoom, right to
// left, another language and `::selection`. `?hostile` adds them; without it the page is the same, plain. The page's
// own content resets them, so it stays narrow and the window does not scroll.

const hostileCss = `
html { font-size: 62.5%; zoom: 1.25; color-scheme: dark; }
body {
    font: italic 900 22px/3 "Courier New", monospace;
    font-variant: small-caps;
    color: rgb(0, 128, 0);
    -webkit-text-fill-color: rgb(255, 0, 255);
    -webkit-font-smoothing: subpixel-antialiased;
    letter-spacing: 4px;
    word-spacing: 12px;
    text-transform: uppercase;
    text-indent: 40px;
    text-align: right;
    text-shadow: 2px 2px rgb(255, 0, 0);
    white-space: pre;
    cursor: wait;
    user-select: none;
    forced-color-adjust: none;
    --radius: 0;
}
main { all: initial; display: block; margin: 8px; font: 16px/1.5 serif; }
main h1 { display: block; margin: 0 0 8px; font-size: 24px; }
*, *::before, *::after {
    box-sizing: content-box;
    --spacing: 1px;
    --radius: 0px;
    --background: 0 100% 50%;
    --foreground: 120 100% 25%;
    --text-sm: 30px;
    --s-gap: 3rem;
    --width: 900px;
}
body > div { display: flex; position: relative; z-index: 0; margin: 40px; padding: 40px; transform: translateZ(0); filter: grayscale(1); zoom: 1.5; content-visibility: auto; }
#uier-toolbar { opacity: 0.6 !important; }
::selection { background-color: rgb(255, 0, 255); color: rgb(0, 255, 0); }
`;

const fixture: PageFixture = {
    page: (url, embed) => {
        const hostile = url.searchParams.has('hostile');
        return `<!doctype html>
<html lang="${hostile ? 'ja' : 'en'}"${hostile ? ' dir="rtl"' : ''}>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Host styles</title>
    ${hostile ? '<link rel="stylesheet" href="/hostile.css">' : ''}
</head>
<body>
    <main>
        <h1>Pricing</h1>
        <p>A page on a site under review.</p>
    </main>
    ${embed}
</body>
</html>`;
    },
    route: (url, _request, response) => {
        if (url.pathname !== '/hostile.css') return false;
        response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        response.end(hostileCss);
        return true;
    }
};

export default fixture;
