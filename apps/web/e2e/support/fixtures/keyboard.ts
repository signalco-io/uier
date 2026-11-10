import type { PageFixture } from './types';

// The Accessibility panel's Keyboard and Screen reader sections (packages/toolbar/docs/page-checks-keyboard.md,
// e2e/page-checks-keyboard.spec.ts): a tab order with a positive tabindex, a skip link, a stop nobody
// can see, a radio group and a button in an open shadow root; buttons with and without focus styles;
// three "Read more" links to different pages; landmarks, headings and controls with states. A tall
// page, so it scrolls, and a focus handler that scrolls it (the focus check must put the scroll back).

const fixture: PageFixture = {
    page: (_url, embed) => `<!doctype html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Keyboard fixture</title>
    <link rel="stylesheet" href="/host.css">
    <script src="/keyboard.js" defer></script>
</head>
<body>
    <a id="skip-link" class="skip-link" href="#content">Skip to content</a>
    <header>
        <nav aria-label="Main"><a id="nav-plans" href="/plans">Plans</a> <a id="nav-docs" href="/docs">Docs</a></nav>
    </header>
    <main id="content">
        <h1>Keyboard fixture</h1>
        <p>A page whose tab order is checked.</p>
        <p><button id="jump-ahead" type="button" tabindex="2">Jump ahead</button> <a id="ghost-link" class="ghost" href="/ghost">Hidden stop</a></p>
        <fieldset>
            <legend>Plan</legend>
            <label><input id="plan-basic" type="radio" name="plan" value="basic"> Basic</label>
            <label><input id="plan-team" type="radio" name="plan" value="team" checked> Team</label>
            <label><input id="plan-scale" type="radio" name="plan" value="scale"> Scale</label>
        </fieldset>
        <div id="shadow-host"><template shadowrootmode="open"><button id="shadow-button" type="button">Inside a shadow root</button></template></div>
        <p>
            <button id="no-ring" type="button">No focus style</button>
            <button id="ring" type="button">Focus ring</button>
            <span class="wrap"><button id="wrapped" type="button">Wrapper reacts</button></span>
        </p>
        <h2>Articles</h2>
        <article><h3>First post</h3><a id="read-first" href="/blog/first">Read more</a></article>
        <article><h3>Second post</h3><a id="read-second" href="/blog/second">Read more</a></article>
        <article><h3>Third post</h3><a id="read-third" href="/blog/third">Read more</a></article>
        <div role="heading" aria-level="4">Questions</div>
        <p><button id="faq-toggle" type="button" aria-expanded="false" aria-controls="faq">Show answers</button> <button id="bold" type="button" aria-pressed="true">Bold</button></p>
        <div id="faq" hidden>Every plan includes the toolbar.</div>
        <section aria-label="Sign up">
            <label>Email <input id="email" type="email" required aria-invalid="true"></label>
            <label><input id="subscribe" type="checkbox" checked> Send me news</label>
        </section>
    </main>
    <footer><a id="footer-plans" href="/plans">Plans</a></footer>
    ${embed}
</body>
</html>`,
    css: `
        body { margin: 0 16px; }
        main { padding-bottom: 1200px; }
        .skip-link { position: absolute; left: -9999px; top: 8px; }
        .skip-link:focus { left: 8px; }
        .ghost { opacity: 0; }
        #no-ring, #ring, #wrapped { outline: none; }
        #ring:focus-visible { outline: 3px solid rgb(30, 90, 200); outline-offset: 2px; }
        .wrap { display: inline-block; padding: 4px; border-radius: 6px; }
        .wrap:focus-within { box-shadow: 0 0 0 3px rgb(30, 90, 200); }`,
    route: (url, _request, response) => {
        if (url.pathname !== '/keyboard.js') return false;
        // The page's own focus handler scrolls to the top
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        response.end(`document.querySelector('#bold').addEventListener('focus', () => window.scrollTo(0, 0));`);
        return true;
    }
};

export default fixture;
