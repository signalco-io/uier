import { expect, test, type Locator } from '@playwright/test';
import { brand } from '@uier/brand';
import { assertAccessibility } from './accessibility';

// The landing's "What it does" tiles each open a page, and the feature pages made for them
// (apps/web/docs/feature-pages.md): their sections, links and animated covers. Their claims come from
// the toolbar's and the app's notes named at the top of each page.

const tiles = [
    { title: 'Pinned to the element, an area or the words', link: 'More on pinned comments', path: '/features/pinned-comments' },
    { title: 'The context comes with it', link: 'More on screenshots and context', path: '/features/screenshots' },
    { title: 'Talk it through in the thread', link: 'More on threads', path: '/features/threads' },
    { title: 'One inbox for the whole site', link: 'More on the inbox', path: '/features/inbox' },
    { title: 'From open to done', link: 'More on statuses and the board', path: '/features/board' },
    { title: 'Accessibility and SEO checks', link: 'More on page checks', path: '/features/page-checks' },
    { title: 'Send it where your team works', link: 'More on integrations', path: '/integrations' },
    { title: 'Let your coding agent fix it', link: `More on AI in ${brand.name}`, path: '/features/ai' }
];

const pages = [
    {
        path: '/features/pinned-comments', title: 'Pinned comments', footer: 'Pinned comments', cover: 'pinned-comments',
        h1: 'Pin each comment to what it is about',
        sections: ['How it works', 'The pin', 'When the page changes', 'Draw on the page', 'Try it', 'Questions'],
        still: 'Comments pinned to a button, an area of the map and a few words.'
    },
    {
        path: '/features/screenshots', title: 'Screenshots and browser context', footer: 'Screenshots and context', cover: 'screenshots',
        h1: 'The context comes with the comment',
        sections: ['How it works', 'Browser and device details', 'Recordings and your own images', 'Private details', 'What a screenshot can miss', 'Try it', 'Questions'],
        still: 'A comment with its screenshot and the phone it was left from; Redact screenshot covers a name in it.'
    },
    {
        path: '/features/threads', title: 'Threads, mentions and assignees', footer: 'Threads', cover: 'threads',
        h1: 'Talk it through in the thread',
        sections: ['How it works', 'Writing a reply', 'Who takes part', 'Try it', 'Questions'],
        still: 'A thread with a mention, an assignee, a reply with an image and a reaction, and the email about the mention.'
    },
    {
        path: '/features/inbox', title: 'Website feedback inbox', footer: 'Inbox', cover: 'inbox',
        h1: 'Every thread on the site, in one inbox',
        sections: ['How it works', 'Staging and production apart', 'And the rest', 'Try it', 'Questions'],
        still: 'The inbox with the threads of every page on the site, each with its page.'
    },
    {
        path: '/features/board', title: 'Feedback statuses and board', footer: 'Statuses and board', cover: 'board',
        h1: 'Follow every thread from open to done',
        sections: ['The built-in statuses', 'How it works', 'The board', 'Find what to work on', 'Try it', 'Questions'],
        still: 'The board’s four columns, from Open to Done, with a thread waiting for its reviewer in Ready to verify.'
    }
];

test('each feature tile on the landing page opens its page', async ({ page }) => {
    await page.goto('/');
    const features = page.getByRole('region', { name: 'What it does' });
    for (const tile of tiles) {
        await expect(features.getByRole('heading', { name: tile.title, exact: true }), tile.title).toBeVisible();
        await expect(features.getByRole('link', { name: tile.link, exact: true }), tile.title).toHaveAttribute('href', tile.path);
    }
    // A link in a tile's text keeps its own place above the tile's link
    await expect(features.getByRole('link', { name: 'Fix verification', exact: true })).toHaveAttribute('href', '/features/fix-verification');

    // The tile rises while hovered, and its whole area opens the page: here a click on its picture
    const tile = features.getByRole('link', { name: 'More on the inbox', exact: true }).locator('xpath=ancestor::div[contains(@class, "group")][1]');
    await tile.scrollIntoViewIfNeeded();
    await expect(tile).toHaveCSS('box-shadow', 'none');
    await tile.hover({ position: { x: 40, y: 40 } });
    await expect(tile).not.toHaveCSS('box-shadow', 'none');
    await tile.click({ position: { x: 40, y: 40 } });
    await expect(page).toHaveURL(/\/features\/inbox$/);
});

/** The play states of a tile's loop: every part runs or rests together */
const loopStates = (loop: Locator) => loop.evaluate(element => [...new Set(element.getAnimations({ subtree: true }).map(animation => animation.playState))]);

test('the feature tiles play their loops only in view, and one button pauses them', async ({ page, isMobile }) => {
    await page.goto('/');
    const features = page.getByRole('region', { name: 'What it does' });
    await expect(features.locator('[data-feature-examples]')).toHaveAttribute('data-feature-examples', 'playing');
    // A touch target is never below 44 px (BRAND.md, "Space")
    const size = await features.getByRole('button', { name: 'Pause examples', exact: true }).boundingBox();
    expect(size?.height).toBe(isMobile ? 44 : 36);
    const loops = features.locator('[data-motion-loop]');
    await expect(loops).toHaveCount(tiles.length);
    // Pictures: out of the accessibility tree and inert, the tile's text says what each shows
    for (const loop of await loops.all()) {
        await expect(loop).toHaveAttribute('aria-hidden', 'true');
        await expect(loop).toHaveAttribute('inert', '');
    }

    // Still until it is in view, and again once it is out of it
    const first = loops.first();
    const last = loops.last();
    expect(await loopStates(last)).toEqual(['paused']);
    await first.scrollIntoViewIfNeeded();
    await expect.poll(() => loopStates(first)).toEqual(['running']);
    expect(await loopStates(last)).toEqual(['paused']);

    // One button stops every tile (WCAG 2.2.2), and a paused tile stays paused when it comes into view
    await features.getByRole('button', { name: 'Pause examples', exact: true }).click();
    await expect.poll(() => loopStates(first)).toEqual(['paused']);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport({ ratio: 0.9 });
    expect(await loopStates(last)).toEqual(['paused']);
    // Without scrolling back up to the button: the last tile stays in view
    await features.getByRole('button', { name: 'Play examples', exact: true }).dispatchEvent('click');
    await expect.poll(() => loopStates(last)).toEqual(['running']);
    await expect.poll(() => loopStates(first)).toEqual(['paused']);
});

test('with reduced motion the feature tiles stay still pictures', async ({ page }) => {
    // A phone's width: the button is on its own line there, so taking it away would move the tiles
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const features = page.getByRole('region', { name: 'What it does' });
    const examples = features.locator('[data-feature-examples]');
    await expect(examples).toHaveAttribute('data-feature-examples', 'still');
    // A note is in the button's place, in the same box
    const button = features.getByRole('button', { name: /examples$/ });
    const note = features.getByText('Examples stay still with reduced motion.', { exact: true });
    await expect(button).toHaveCount(0);
    await expect(note).toBeVisible();
    const first = features.locator('[data-motion-loop]').first();
    await first.scrollIntoViewIfNeeded();
    expect(await loopStates(first)).toEqual([]);
    /** Where the tiles start on the page, and the box the button and the note share */
    const geometry = () => features.evaluate(element => {
        const grid = element.querySelector('[data-feature-examples]')!.getBoundingClientRect();
        const control = element.querySelector('[data-feature-examples-control]')!.getBoundingClientRect();
        return { grid: grid.top + scrollY, control: [control.left, control.top + scrollY, control.width, control.height], fits: document.documentElement.scrollWidth <= innerWidth };
    });
    const still = await geometry();
    expect(still.fits).toBe(true);

    // Read live: turned off the loops play, and nothing has moved
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => loopStates(first)).toEqual(['running']);
    await expect(button).toBeVisible();
    await expect(note).toBeHidden();
    expect(await geometry()).toEqual(still);

    // Turned on mid-loop with the focus on the button: the loops stop on the still picture, the tiles
    // stay where they are and the focus goes to the note instead of falling to the page
    await button.focus();
    await expect(button).toBeFocused();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => loopStates(first)).toEqual([]);
    await expect(examples).toHaveAttribute('data-feature-examples', 'still');
    await expect(button).toHaveCount(0);
    await expect(note).toBeFocused();
    expect(await geometry()).toEqual(still);

    // And back: the focus returns to the button
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(button).toBeFocused();
    expect(await geometry()).toEqual(still);
});

test('a tile loop moves nothing around it on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const features = page.getByRole('region', { name: 'What it does' });
    // The board's loop drags a card to the next column: the widest move of the eight
    const tile = features.getByRole('link', { name: 'More on statuses and the board', exact: true }).locator('xpath=ancestor::div[contains(@class, "group")][1]');
    const loop = tile.locator('[data-motion-loop]');
    await loop.scrollIntoViewIfNeeded();
    await expect.poll(() => loopStates(loop)).toEqual(['running']);
    const geometry = () => tile.evaluate(element => {
        const picture = element.querySelector('[data-motion-loop]')!.getBoundingClientRect();
        const title = element.querySelector('h3')!.getBoundingClientRect();
        return { height: picture.height, width: picture.width, title: title.top - picture.top, fits: document.documentElement.scrollWidth <= innerWidth };
    });
    const start = await geometry();
    expect(start.fits).toBe(true);
    // Through the loop: the card lifted, dropped in the next column, and back
    for (const seconds of [3.5, 5, 8.2, 12]) {
        await loop.evaluate((element, time) => {
            for (const animation of element.getAnimations({ subtree: true }))
                animation.currentTime = time * 1000 + Number(animation.effect?.getTiming().delay ?? 0);
        }, seconds);
        expect(await geometry(), `${seconds} s`).toEqual(start);
    }
});

for (const feature of pages) {
    test(`${feature.path} explains the feature with its cover`, async ({ page }) => {
        const response = await page.goto(feature.path);
        expect(response?.status()).toBe(200);
        await expect(page).toHaveTitle(`${feature.title} · ${brand.name}`);
        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 1, name: feature.h1 })).toBeVisible();
        for (const name of feature.sections)
            await expect(page.getByRole('region', { name, exact: true }), name).toBeVisible();
        await expect(main.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/app');
        await expect(main.getByRole('link', { name: 'main questions' })).toHaveAttribute('href', '/#faq');
        await expect(page.getByRole('contentinfo').getByRole('link', { name: feature.footer, exact: true })).toHaveAttribute('href', feature.path);
        await main.getByRole('link', { name: 'How it works', exact: true }).click();
        await expect(page).toHaveURL(/#how-it-works$/);

        // The cover is a picture: out of the accessibility tree, with Pause for its loop
        const cover = page.locator(`[data-feature-cover="${feature.cover}"]`);
        await expect(cover).toHaveAttribute('aria-hidden', 'true');
        await cover.scrollIntoViewIfNeeded();
        const pause = page.getByRole('button', { name: 'Pause the animation' });
        await pause.click();
        await expect(page.getByRole('button', { name: 'Play the animation' })).toBeVisible();

        const cost = page.getByRole('region', { name: 'Questions', exact: true }).locator('details').filter({ hasText: 'What does it cost?' });
        await cost.locator('summary').click();
        await expect(cost.getByText(brand.pricing)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test(`${feature.path} cover shows one still frame with reduced motion`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(feature.path);
        await page.locator(`[data-feature-cover="${feature.cover}"]`).scrollIntoViewIfNeeded();
        await expect(page.locator('[data-feature-cover-caption] p:not(.invisible)')).toHaveText(feature.still);
        await expect(page.getByRole('button', { name: /^(Pause|Play) the animation$/ })).toHaveCount(0);
    });

    test(`${feature.path} is accessible`, ({ page }) => assertAccessibility(page, feature.path));
}

test('the board explains custom names and the project verification opt-in', async ({ page }) => {
    await page.goto('/features/board');
    const statuses = page.getByRole('region', { name: 'The built-in statuses', exact: true });
    await expect(statuses).toContainText('Ready to verify is hidden while fix verification is off, which is the default');
    await expect(statuses).toContainText('Admins can define workspace statuses and override them for a project');
    const custom = page.getByRole('region', { name: 'Questions', exact: true }).locator('details').filter({ hasText: 'Can the team use its own status names?' });
    await custom.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(custom).toContainText('column per available status');
    await expect(custom).toContainText('Guests keep the ordinary category actions');
});

test('a feature cover plays its captions without moving the page under it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/features/board');
    await page.locator('[data-feature-cover="board"]').scrollIntoViewIfNeeded();
    const heading = page.getByRole('heading', { name: 'The built-in statuses' });
    const top = () => heading.evaluate(element => element.getBoundingClientRect().top + window.scrollY);
    const caption = page.locator('[data-feature-cover-caption] p:not(.invisible)');
    const start = await top();
    for (const text of ['Ready to verify asks', 'When the reviewer confirms', 'Drag a thread']) {
        await expect(caption).toContainText(text, { timeout: 20_000 });
        expect(await top()).toBe(start);
    }
    // Turned on mid-loop, reduced motion stops on the still frame
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(caption).toHaveText(/^The board’s four columns/);
});
