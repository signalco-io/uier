import { expect, test, type Page } from '@playwright/test';
import { isolatedOrigin, newVisitor, openLanding, openThread, toolbar } from './support/toolbar';
import { expectNoAxeViolations } from './accessibility';

// Canvas mode (packages/toolbar/docs/canvas-mode.md): drawing on the page with the toolbar, then one
// comment with the drawing. The shapes are saved with the comment, shown on the page where they were
// drawn (also after scrolling and a reload) and painted into its screenshot.

type SavedComment = { id: string; thread: { items: { text: string }[] }; drawing?: { width: number; height: number; shapes: { type: string; text?: string; color?: string }[] }; screenshot?: { width: number } };

const panel = (page: Page) => page.getByRole('toolbar', { name: 'Drawing tools' });
const surface = (page: Page) => page.getByRole('application', { name: 'Drawing' });

async function savedComment(page: Page, text: string) {
    const comments = await page.evaluate(async () => await (await fetch('/api/comments?path=/')).json() as SavedComment[]);
    return comments.find(comment => comment.thread.items[0]?.text === text);
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
}

/** How many strongly red pixels the comment's saved screenshot has (the page itself has none) */
async function redPixels(page: Page, commentId: string) {
    return await page.evaluate(async (commentId) => {
        const blob = await (await fetch(`/api/comments/${commentId}/screenshot`)).blob();
        const image = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, image.width, image.height).data;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i]! > 180 && data[i + 1]! < 90 && data[i + 2]! < 90) count++;
        return count;
    }, commentId);
}

test('canvas mode: draw shapes and a note, undo and redo, comment, and see the drawing on the page and in the screenshot', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    const heading = page.getByRole('heading', { level: 1 });
    const box = (await heading.boundingBox())!;

    await toolbar(page).getByRole('button', { name: 'Draw on the page' }).click();
    await expect(toolbar(page).getByRole('button', { name: 'Draw on the page' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page)).toBeVisible();
    await expect(surface(page)).toBeFocused();
    // The pen is the first tool; Comment waits for a shape
    await expect(panel(page).getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).getByRole('button', { name: 'Comment' })).toBeDisabled();
    await expectNoAxeViolations(page);

    // A rectangle around the headline, an arrow pointing at it, a pen line
    await panel(page).getByRole('button', { name: 'Rectangle' }).click();
    await drag(page, { x: box.x - 8, y: box.y - 8 }, { x: box.x + Math.min(box.width, 400), y: box.y + box.height + 8 });
    await panel(page).getByRole('button', { name: 'Arrow' }).click();
    // Within the window on a phone too
    const arrowStart = Math.min(box.x + 450, page.viewportSize()!.width - 16);
    await drag(page, { x: arrowStart, y: box.y + box.height + 80 }, { x: arrowStart - 150, y: box.y + box.height + 12 });
    await panel(page).getByRole('button', { name: 'Pen' }).click();
    await drag(page, { x: box.x + 20, y: box.y + box.height + 40 }, { x: box.x + 200, y: box.y + box.height + 50 });
    await expect(surface(page).locator('[data-uier-canvas-shape]')).toHaveCount(3);

    // A text note: typed in place, Esc keeps it
    await panel(page).getByRole('button', { name: 'Text note' }).click();
    await page.mouse.click(box.x + 20, box.y + box.height + 90);
    const note = page.getByRole('textbox', { name: 'Text note' });
    await expect(note).toBeFocused();
    await note.pressSequentially('Make this bigger');
    await note.press('Escape');
    await expect(note).toHaveCount(0);
    await expect(surface(page).getByRole('button', { name: 'Text note 1' })).toBeAttached();

    // Undo takes the note away, redo brings it back
    await page.keyboard.press('ControlOrMeta+z');
    await expect(surface(page).locator('[data-uier-canvas-shape]')).toHaveCount(3);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(surface(page).locator('[data-uier-canvas-shape]')).toHaveCount(4);

    // The style: a selected shape changes, and so do the next ones
    await panel(page).getByRole('button', { name: 'Select' }).click();
    await page.mouse.click(box.x - 8, box.y + 4);
    await expect(surface(page).getByRole('button', { name: 'Rectangle 1' })).toHaveAttribute('aria-pressed', 'true');
    await panel(page).getByRole('button', { name: 'Style' }).click();
    const style = page.getByRole('dialog', { name: 'Style' });
    await style.getByRole('radiogroup', { name: 'Outline' }).getByRole('radio', { name: 'Dashed' }).click();
    await expect(style.getByRole('radiogroup', { name: 'Outline' }).getByRole('radio', { name: 'Dashed' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // Blur has no style: the button says why and opens nothing
    await panel(page).getByRole('button', { name: 'Blur' }).click();
    const styleButton = panel(page).getByRole('button', { name: 'Style' });
    await expect(styleButton).toHaveAttribute('aria-disabled', 'true');
    await expect(styleButton).toHaveAccessibleDescription('Blur has no colour or width');
    await styleButton.focus();
    await page.keyboard.press('Enter');
    await expect(style).toHaveCount(0);
    await panel(page).getByRole('button', { name: 'Pen' }).click();
    await expect(styleButton).not.toHaveAttribute('aria-disabled');

    await panel(page).getByRole('button', { name: 'Comment' }).click();
    await expect(panel(page)).toHaveCount(0);
    const draft = page.getByRole('dialog', { name: 'New comment' });
    await expect(draft.getByRole('textbox', { name: 'Comment' })).toBeFocused();
    // The drawing stays on the page while the comment is written
    await expect(page.locator('[data-uier-drawing-comment] path').first()).toBeAttached();
    await draft.getByRole('textbox', { name: 'Comment' }).fill('The headline needs room.');
    await draft.getByRole('button', { name: 'Post comment' }).click();
    await expect(openThread(page).getByText('The headline needs room.')).toBeVisible();

    await expect.poll(async () => (await savedComment(page, 'The headline needs room.'))?.screenshot?.width).toBeGreaterThan(0);
    const saved = (await savedComment(page, 'The headline needs room.'))!;
    expect(saved.drawing?.shapes.map(shape => shape.type)).toEqual(['rectangle', 'arrow', 'pen', 'text']);
    expect(saved.drawing?.shapes[0]).toMatchObject({ dash: 'dashed', color: 'red' });
    expect(saved.drawing?.shapes[3]).toMatchObject({ text: 'Make this bigger' });
    // Painted into the screenshot: the landing page has no red of its own
    expect(await redPixels(page, saved.id)).toBeGreaterThan(50);

    // After a reload the drawing is where it was drawn, and it scrolls with the page
    await page.reload();
    await expect(toolbar(page)).toBeVisible();
    const layer = page.locator(`[data-uier-drawing-comment="${saved.id}"]`);
    await expect(layer.locator('path')).not.toHaveCount(0);
    await expect(layer.getByText('Make this bigger')).toBeAttached();
    // The note's text starts where it was clicked, inside 6 px of padding (textPadding in canvas/geometry.ts)
    const noteBox = (await layer.getByText('Make this bigger').boundingBox())!;
    expect(Math.abs(noteBox.x + 6 - (box.x + 20))).toBeLessThan(4);
    expect(Math.abs(noteBox.y + 6 - (box.y + box.height + 90))).toBeLessThan(4);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await layer.getByText('Make this bigger').boundingBox())!.y).toBeLessThan(noteBox.y - 100);
    await context.close();
});

test('canvas mode: the keyboard adds, moves and deletes shapes; Esc and Discard leave', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await toolbar(page).getByRole('button', { name: 'Draw on the page' }).click();
    await expect(surface(page)).toBeFocused();

    // Esc with nothing drawn leaves canvas mode
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await toolbar(page).getByRole('button', { name: 'Draw on the page' }).click();
    await expect(surface(page)).toBeFocused();

    // R chooses the rectangle, Enter adds one in the middle of the window, focused and selected
    await page.keyboard.press('r');
    await expect(panel(page).getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    const rectangle = surface(page).getByRole('button', { name: 'Rectangle 1' });
    await expect(rectangle).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Rectangle added' })).toBeAttached();
    const before = (await rectangle.boundingBox())!;
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await rectangle.boundingBox())!.x).toBeCloseTo(before.x + 10, 0);
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(async () => (await rectangle.boundingBox())!.height).toBeCloseTo(before.height + 1, 0);
    await expectNoAxeViolations(page);

    // A freehand tool needs a pointer: it says so
    await surface(page).focus();
    await page.keyboard.press('p');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'This tool draws with a pointer.' })).toBeAttached();

    // Delete removes the focused shape; Esc with a shape drawn does not leave
    await rectangle.focus();
    await page.keyboard.press('Delete');
    await expect(surface(page).locator('[data-uier-canvas-shape]')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(surface(page).locator('[data-uier-canvas-shape]')).toHaveCount(1);
    await surface(page).focus();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeVisible();

    // Draw on the page again goes to Comment instead of losing the drawing; Discard leaves
    await toolbar(page).getByRole('button', { name: 'Draw on the page' }).click();
    await expect(panel(page).getByRole('button', { name: 'Comment' })).toBeFocused();
    await panel(page).getByRole('button', { name: 'Discard' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(toolbar(page).getByRole('button', { name: 'Draw on the page' })).toBeFocused();
    await context.close();
});

test('canvas mode: Edit drawing goes back to the shapes with the comment text kept @mobile-smoke', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await toolbar(page).getByRole('button', { name: 'Draw on the page' }).click();
    // The tools fit the window, on a phone too
    const tools = (await panel(page).boundingBox())!;
    expect(tools.x).toBeGreaterThanOrEqual(0);
    expect(tools.x + tools.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    await surface(page).focus();
    await page.keyboard.press('o');
    await page.keyboard.press('Enter');
    await panel(page).getByRole('button', { name: 'Comment' }).click();
    const draft = page.getByRole('dialog', { name: 'New comment' });
    await draft.getByRole('textbox', { name: 'Comment' }).fill('Kept while editing.');
    await draft.getByRole('button', { name: 'Edit drawing' }).click();
    await expect(surface(page).getByRole('button', { name: 'Ellipse 1' })).toBeAttached();
    await panel(page).getByRole('button', { name: 'Comment' }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment' })).toHaveText('Kept while editing.', { useInnerText: true });
    // Discard in the form removes the drawing too
    await draft.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('[data-uier-drawing-comment]')).toHaveCount(0);
    await context.close();
});

test('canvas mode: Draw on the page with a drawing\'s comment unsent goes on with that drawing', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    await toolbar(page).getByRole('button', { name: 'Draw on the page' }).click();
    await surface(page).focus();
    await page.keyboard.press('o');
    await page.keyboard.press('Enter');
    await panel(page).getByRole('button', { name: 'Comment' }).click();
    const draft = page.getByRole('dialog', { name: 'New comment' });
    await draft.getByRole('textbox', { name: 'Comment' }).fill('Both drawings.');

    // A new session takes the unsent drawing's shapes: one session, one comment, nothing lost
    await toolbar(page).getByRole('button', { name: 'Draw on the page' }).click();
    await expect(surface(page).getByRole('button', { name: 'Ellipse 1' })).toBeAttached();
    await surface(page).focus();
    await page.keyboard.press('r');
    await page.keyboard.press('Enter');
    await expect(surface(page).locator('[data-uier-canvas-shape]')).toHaveCount(2);
    await panel(page).getByRole('button', { name: 'Comment' }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment' })).toHaveText('Both drawings.', { useInnerText: true });
    await draft.getByRole('button', { name: 'Post comment' }).click();
    await expect(openThread(page).getByText('Both drawings.')).toBeVisible();
    await expect.poll(async () => (await savedComment(page, 'Both drawings.'))?.drawing?.shapes.map(shape => shape.type)).toEqual(['ellipse', 'rectangle']);
    await context.close();
});

test('canvas mode: Edit drawing keeps the shapes on the scrolled content they were drawn on', async ({ browser }, testInfo) => {
    const { context, page } = await newVisitor(browser, testInfo);
    await openLanding(page, isolatedOrigin(testInfo), { dismissHint: true });
    // A panel of its own that scrolls (an app's main column), styled through the CSSOM for the page's CSP;
    // below the drawing tools, which take the top of a phone's window
    await page.evaluate(() => {
        const scroller = document.createElement('div');
        scroller.id = 'canvas-scroller';
        Object.assign(scroller.style, { position: 'fixed', left: '24px', top: '260px', width: '300px', height: '240px', overflow: 'auto', zIndex: '5', background: 'white' });
        const content = document.createElement('div');
        content.style.height = '1200px';
        const target = document.createElement('p');
        target.id = 'canvas-scroller-target';
        target.textContent = 'Scrolled content';
        Object.assign(target.style, { margin: '40px 20px', height: '120px' });
        content.append(target);
        scroller.append(content);
        document.body.append(scroller);
    });
    const target = page.locator('#canvas-scroller-target');
    const box = (await target.boundingBox())!;

    await toolbar(page).getByRole('button', { name: 'Draw on the page' }).click();
    await panel(page).getByRole('button', { name: 'Rectangle' }).click();
    await drag(page, { x: box.x + 20, y: box.y + 20 }, { x: box.x + 200, y: box.y + 90 });
    await panel(page).getByRole('button', { name: 'Comment' }).click();
    const draft = page.getByRole('dialog', { name: 'New comment' });
    await draft.getByRole('textbox', { name: 'Comment' }).fill('On the scrolled content.');
    await draft.getByRole('button', { name: 'Edit drawing' }).click();

    // The shape stays where it is on the content as the panel scrolls
    const rectangle = surface(page).getByRole('button', { name: 'Rectangle 1' });
    const fromTarget = async () => {
        const [shape, content] = [(await rectangle.boundingBox())!, (await target.boundingBox())!];
        return { x: Math.round(shape.x - content.x), y: Math.round(shape.y - content.y) };
    };
    const before = await fromTarget();
    await page.locator('#canvas-scroller').evaluate(element => { element.scrollTop = 60; });
    await expect.poll(async () => (await target.boundingBox())!.y).toBeLessThan(box.y - 50);
    await expect.poll(fromTarget).toEqual(before);
    await panel(page).getByRole('button', { name: 'Comment' }).click();
    await expect(draft.getByRole('textbox', { name: 'Comment' })).toHaveText('On the scrolled content.', { useInnerText: true });
    await context.close();
});
