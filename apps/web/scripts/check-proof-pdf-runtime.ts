import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { pdfAdapter } from '../src/lib/proofs/adapters/pdf';

// Exercise production rasterization, the OCR worker, and the font-backed search layer from a
// deployed-style dependency tree. Keep a visible label distinct from private source payloads.
const source = await PDFDocument.create();
const marker = 'PRIVATE-PDF-PACKAGING-MARKER';
source.setTitle(marker);
source.addJavaScript('private', `app.alert('${marker}')`);
await source.attach(Buffer.from(marker), `${marker}.txt`);
const font = await source.embedFont(StandardFonts.Helvetica);
for (const label of ['GARDEN MENU', 'CITRUS SALAD']) {
    const page = source.addPage([480, 280]);
    page.drawText(label, { x: 42, y: 156, size: 38, font });
    page.drawText(marker, { x: 42, y: 48, size: 12, font, opacity: 0 });
}
const original = Buffer.from(await source.save({ useObjectStreams: false }));
const { manifest, artifacts } = await pdfAdapter.ingest({
    bytes: original, filename: 'packaging-fixture.pdf', contentType: 'application/pdf', signal: AbortSignal.timeout(70_000)
});
assert.equal(manifest.pdf?.rendition, 'raster-ocr-v1');
assert.equal(manifest.surfaces.length, 2);
assert.deepEqual(artifacts.map(({ id }) => id), ['document', 'page-text']);
const [document, evidence] = artifacts;
assert.ok(document && evidence);
for (const artifact of artifacts) {
    assert.ok(!artifact.bytes.equals(original));
    assert.ok(!artifact.bytes.includes(marker));
}
const pages = JSON.parse(evidence.bytes.toString('utf8')) as { text: string }[];
assert.deepEqual(pages.map(page => page.text), ['GARDEN MENU', 'CITRUS SALAD']);

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const task = getDocument({ data: new Uint8Array(document.bytes), useSystemFonts: false });
try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 2);
    assert.equal(await pdf.getAttachments(), null);
    assert.equal(await pdf.getJSActions(), null);
    assert.ok(!JSON.stringify(await pdf.getMetadata()).includes(marker));
    for (const [index, label] of ['GARDEN MENU', 'CITRUS SALAD'].entries()) {
        const { items } = await (await pdf.getPage(index + 1)).getTextContent();
        const text = items.flatMap(item => 'str' in item ? [item.str] : []).join(' ').replace(/\s+/g, ' ').trim();
        assert.equal(text, label);
    }
} finally {
    await task.destroy();
}
