import type { PageFixture } from './types';

// The Accessibility panel's Alt text, Zoom and text spacing, and Motion sections
// (packages/toolbar/docs/page-checks-content.md, e2e/page-checks-content.spec.ts): images with good,
// file-name, prefixed, placeholder, long and empty alt text; a wide element and a wide element in a
// box that scrolls sideways; fixed-size boxes whose text fits until text spacing is applied; an
// endless, a long and a short CSS animation, players that start on their own and a GIF. Images and
// styles come from this origin (`/host.css`): the site's CSP allows no inline styles or scripts.

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Over the section's 150 characters */
export const longAlt = 'A wide photo of the office at the start of the day, with six desks by the window, plants on every shelf, a whiteboard full of plans and two people talking by the coffee machine';

const fixture: PageFixture = {
    // `?clip`: the page clips what sticks out instead of scrolling sideways. A phone widens its layout
    // viewport to content that scrolls sideways, and the toolbar's fixed controls move with it
    head: url => url.searchParams.has('clip') ? '<link rel="stylesheet" href="/content/clip.css">' : '',
    body: () => `<section id="content-checks">
        <h2>Our team</h2>
        <div class="content-images">
            <img id="alt-good" src="/content/team-photo.png" alt="Two people reviewing a page on a laptop" width="48" height="48">
            <img id="alt-file" src="/content/IMG_4021.jpg" alt="IMG_4021.jpg" width="48" height="48">
            <img id="alt-prefix" src="/content/chart.png" alt="Image of a chart with monthly sign-ups" width="48" height="48">
            <img id="alt-placeholder" src="/content/photo.png" alt="image" width="48" height="48">
            <img id="alt-long" src="/content/office.png" alt="${longAlt}" width="48" height="48">
            <img id="alt-empty" src="/content/divider.png" alt="" width="48" height="8">
            <img id="alt-logo" src="/content/logo.png" alt="Logo" width="48" height="48">
            <img id="alt-broken" src="/content/missing.png" alt="Sign-ups by month" width="48" height="48">
            <img id="alt-hidden" src="/content/hidden.png" alt="IMG_9999.png" width="48" height="48" hidden>
            <svg id="alt-svg" role="img" width="48" height="48" viewBox="0 0 48 48"><title>Growth since launch</title><rect width="48" height="48"></rect></svg>
            <img id="loader-gif" src="/content/loader.gif" alt="Loading plans" width="16" height="16">
        </div>
        <div id="content-wide" class="content-wide">A banner that is wider than any window.</div>
        <div class="content-scroller"><div id="content-scrolled" class="content-scrolled">A table that scrolls sideways on purpose.</div></div>
        <div id="content-fixed" class="content-fixed"></div>
        <div id="spacing-clip" class="content-box content-clip">Plans renew every month.<br>Cancel at any time.</div>
        <div id="spacing-spill" class="content-box content-spill">Every plan includes the toolbar.<br>Reviews never expire.</div>
        <div id="spacing-nowrap" class="content-nowrap">Annual plans save a month</div>
        <div id="spacing-already" class="content-box content-already">This box cut its text off before any spacing was applied, and it still does.</div>
        <div id="spacing-scroll" class="content-box content-scroll">Plans renew every month.<br>Cancel at any time.</div>
        <p id="spacing-paragraph">Questions? Write to the team.</p>
        <p><span id="motion-pulse" class="motion-pulse">New</span> <span id="motion-slide" class="motion-slide">Spring sale</span> <span id="motion-fade" class="motion-fade">Welcome</span></p>
        <marquee id="motion-marquee">Plans change every week</marquee>
        <video id="content-video" src="/content/clip.mp4" width="160" height="90" autoplay muted loop playsinline></video>
        <audio id="content-audio" src="/content/sound.mp3" autoplay loop></audio>
    </section>`,
    css: `
        .content-images { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .content-wide { width: 1600px; background: rgb(230, 236, 250); }
        .content-scroller { overflow-x: auto; max-width: 100%; }
        .content-scrolled { width: 1800px; }
        .content-fixed { position: fixed; left: 0; bottom: 0; width: 2400px; height: 1px; pointer-events: none; }
        .content-box { width: 320px; margin: 8px 0; font: 16px/1.2 sans-serif; }
        .content-clip { height: 40px; overflow: hidden; }
        .content-spill { height: 40px; }
        .content-nowrap { width: 264px; white-space: nowrap; overflow: hidden; font: 16px/1.2 monospace; }
        .content-already { height: 10px; overflow: hidden; }
        .content-scroll { height: 40px; overflow: auto; }
        .motion-pulse, .motion-slide, .motion-fade { display: inline-block; }
        .motion-pulse { animation: content-pulse 2s ease-in-out infinite; }
        .motion-slide { animation: content-slide 30s linear 1; }
        .motion-fade { animation: content-fade 1s ease-out 1; }
        @keyframes content-pulse { 50% { opacity: 0.6; } }
        @keyframes content-slide { to { transform: translateX(40px); } }
        @keyframes content-fade { from { opacity: 0.2; } }`,
    route: (url, _request, response) => {
        if (!url.pathname.startsWith('/content/')) return false;
        if (url.pathname === '/content/clip.css') {
            response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
            response.end('html, body { overflow-x: clip; }');
            return true;
        }
        const image = /\.(png|jpg)$/.test(url.pathname) && !url.pathname.endsWith('/missing.png') ? png : url.pathname.endsWith('.gif') ? gif : undefined;
        if (!image) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('Not found');
            return true;
        }
        response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.gif') ? 'image/gif' : 'image/png', 'Cache-Control': 'max-age=3600' });
        response.end(image);
        return true;
    }
};

export default fixture;
