import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { commentDrawing, drawingLimits, drawingSummary, parseDrawing, type CommentDrawing } from '@uier/toolbar/drawing';
import { feedbackDrawing } from '@uier/toolbar/feedback-context';

// Drawings on the page (the toolbar's canvas mode, packages/toolbar/docs/canvas-mode.md): one comment's
// vector shapes, saved on an area, validated and bounded by the API, returned like the rest of the
// thread and described in the feedback packet.

const area = { type: 'point', selector: 'body>main>h1,#hero>h1', xNormal: 0.1, yNormal: 0.2, widthNormal: 0.5, heightNormal: 0.4 };
const style = { color: 'red', size: 'm' } as const;

const drawing: CommentDrawing = {
    version: 1,
    width: 320,
    height: 180,
    shapes: [
        { id: 'pen1', seed: 1, type: 'pen', ...style, points: [10, 10, 40, 30, 80, 20] },
        { id: 'arrow1', seed: 2, type: 'arrow', ...style, sketchy: true, x1: 20, y1: 150, x2: 200, y2: 60 },
        { id: 'box1', seed: 3, type: 'rectangle', color: 'blue', size: 's', dash: 'dashed', fill: 'amber', x: 100, y: 40, width: 120, height: 60 },
        { id: 'blur1', seed: 4, type: 'blur', x: 230, y: 20, width: 60, height: 40 },
        { id: 'note1', seed: 5, type: 'text', color: 'ink', size: 'l', fill: 'white', fillStyle: 'solid', x: 30, y: 100, width: 140, height: 31, text: 'Make this *bigger* @team' }
    ]
};

function pagePath() {
    return `/e2e/canvas-${randomUUID()}`;
}

test('a comment on an area keeps its drawing: known fields only, listed with the thread, described in the packet', async ({ request }) => {
    const path = pagePath();
    const withExtras = {
        ...drawing,
        script: 'alert(1)',
        shapes: drawing.shapes.map((shape, index) => index === 0 ? { ...shape, onclick: 'alert(1)', style: 'fill:url(javascript:)' } : shape)
    };
    const response = await request.post('/api/comments', { data: { path, position: area, text: 'Look at the drawing.', drawing: withExtras } });
    expect(response.status()).toBe(201);
    const saved = await response.json();
    expect(saved.drawing).toEqual(drawing);

    const list = await (await request.get(`/api/comments?path=${encodeURIComponent(path)}`)).json();
    expect(list.find((comment: { id: string }) => comment.id === saved.id).drawing).toEqual(drawing);

    const packet = await (await request.get(`/api/comments/${saved.id}/context`)).json();
    expect(packet.context.drawing).toEqual({
        shapes: 5,
        summary: '1 pen line, 1 arrow, 1 rectangle, 1 text note, 1 blurred area',
        width: 320,
        height: 180,
        notes: ['Make this *bigger* @team']
    });
    expect(packet.markdown).toContain('Drawing on the page: 5 shapes (1 pen line, 1 arrow, 1 rectangle, 1 text note, 1 blurred area) in 320×180 CSS px, drawn over the area. The saved screenshot includes it.');
    // A note's text is untrusted content: fenced like the messages, never Markdown
    expect(packet.markdown).toContain('Text notes in the drawing:\n\n```text\nMake this *bigger* @team\n```');

    // Comments without one have none
    const plain = await (await request.post('/api/comments', { data: { path, position: area, text: 'No drawing here.' } })).json();
    expect(plain.drawing).toBeUndefined();
    expect((await (await request.get(`/api/comments/${plain.id}/context`)).json()).context.drawing).toBeUndefined();
});

test('drawings are refused when they are not a drawing on an area, or beyond the limits', async ({ request }) => {
    const post = (data: Record<string, unknown>) => request.post('/api/comments', { data: { path: pagePath(), position: area, text: 'Drawn.', ...data } });
    const shape = drawing.shapes[0]!;
    const refused: Record<string, unknown>[] = [
        // Not on an area: a point, the page, a rewrite
        { position: { ...area, widthNormal: undefined, heightNormal: undefined }, drawing },
        { position: { type: 'page' }, kind: 'bug', drawing },
        { drawing: { ...drawing, version: 2 } },
        { drawing: { ...drawing, shapes: [] } },
        { drawing: { ...drawing, width: drawingLimits.side + 1 } },
        { drawing: { ...drawing, shapes: [{ ...shape, type: 'image', href: 'https://example.com/x.png' }] } },
        // Colours are the brand's names, never values
        { drawing: { ...drawing, shapes: [{ ...shape, color: '#ff0000' }] } },
        { drawing: { ...drawing, shapes: [{ ...shape, size: 'xxl' }] } },
        { drawing: { ...drawing, shapes: [{ ...shape, id: 'a b' }] } },
        { drawing: { ...drawing, shapes: [shape, { ...shape }] } },
        { drawing: { ...drawing, shapes: [{ ...shape, points: [1, 2, 3] }] } },
        { drawing: { ...drawing, shapes: [{ ...shape, points: [0, 0, drawingLimits.side + 1, 0] }] } },
        { drawing: { ...drawing, shapes: [{ ...shape, points: Array.from({ length: (drawingLimits.shapePoints + 1) * 2 }, (_, i) => i % 50) }] } },
        { drawing: { ...drawing, shapes: [{ ...shape, pressures: [50] }] } },
        { drawing: { ...drawing, shapes: [{ id: 'n', seed: 1, type: 'text', ...style, x: 0, y: 0, width: 10, height: 10, text: ' \n​ ' }] } },
        { drawing: { ...drawing, shapes: [{ id: 'n', seed: 1, type: 'text', ...style, x: 0, y: 0, width: 10, height: 10, text: 'x'.repeat(drawingLimits.text + 1) }] } },
        { drawing: { ...drawing, shapes: Array.from({ length: drawingLimits.shapes + 1 }, (_, i) => ({ ...shape, id: `s${i}` })) } }
    ];
    for (const data of refused) {
        const response = await post(data);
        expect(response.status(), JSON.stringify(data).slice(0, 200)).toBe(400);
    }
    // The whole drawing is bounded too, within the request's budget
    const large = { ...drawing, shapes: Array.from({ length: 30 }, (_, i) => ({ ...shape, id: `p${i}`, points: Array.from({ length: 400 }, (_, j) => 1000 + (j % 97)) })) };
    expect(JSON.stringify(large).length).toBeGreaterThan(drawingLimits.length);
    expect((await post({ drawing: large })).status()).toBe(400);
});

test('stored drawings are read defensively and summarized for the packet', () => {
    expect(commentDrawing(undefined)).toBeUndefined();
    expect(commentDrawing({ version: 1, width: 10, height: 10, shapes: [{ id: 'x', seed: 1, type: 'pen', color: 'red', size: 'm', points: 'oops' }] })).toBeUndefined();
    expect(typeof parseDrawing({ ...drawing, shapes: [{ ...drawing.shapes[1], sketchy: 'yes' }] })).toBe('string');
    // A solid fill without a background is dropped; bidirectional controls leave a note's text
    const parsed = parseDrawing({ ...drawing, shapes: [{ id: 'r', seed: 1, type: 'rectangle', ...style, fillStyle: 'solid', x: 0, y: 0, width: 5, height: 5 },
        { id: 't', seed: 2, type: 'text', ...style, x: 0, y: 0, width: 5, height: 5, text: 'a‮b\r\nc  ' }] });
    expect(parsed).toMatchObject({ shapes: [{ id: 'r' }, { id: 't', text: 'ab\nc' }] });
    expect((parsed as CommentDrawing).shapes[0]).not.toHaveProperty('fillStyle');
    expect(drawingSummary({ ...drawing, shapes: [drawing.shapes[1]!, drawing.shapes[1]!] }).text).toBe('2 arrows');
    expect(feedbackDrawing(drawing)).toMatchObject({ shapes: 5, notes: ['Make this *bigger* @team'] });
});
