const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

function quoteSpans(layer: HTMLElement) {
    const spans = Array.from(layer.querySelectorAll<HTMLElement>('span[role="presentation"]'));
    let text = '';
    const ranges = spans.flatMap(span => {
        const value = normalize(span.textContent ?? '');
        if (!value) return [];
        const start = text.length;
        text += value + ' ';
        return [{ start, end: text.length - 1, span }];
    });
    return { text, ranges };
}

export function textMatches(text: string, quote: string, limit = 100_001) {
    const needle = normalize(quote);
    const matches: number[] = [];
    if (!needle) return matches;
    for (let index = text.indexOf(needle); index >= 0 && matches.length < limit; index = text.indexOf(needle, index + 1)) matches.push(index);
    return matches;
}

export function selectedPdfQuote(layer: HTMLElement, selection: Selection) {
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const quote = selection.toString().trim().slice(0, 500);
    if (!quote) return;
    const { text, ranges } = quoteSpans(layer);
    const startRange = ranges.find(entry => entry.span.contains(range.startContainer));
    if (!startRange) return { quote };
    const start = document.createRange();
    start.selectNodeContents(startRange.span);
    start.setEnd(range.startContainer, range.startOffset);
    const prefix = start.toString().replace(/\s+/g, ' ').trimStart();
    const position = startRange.start + prefix.length + (range.toString().match(/^\s+/)?.[0] ? 1 : 0);
    const occurrence = textMatches(text, quote).findIndex(match => match === position);
    return occurrence < 0 ? { quote } : { quote, occurrence };
}

export function pdfHighlight(layer: HTMLElement, quote: string, occurrence?: number) {
    const { text, ranges } = quoteSpans(layer);
    const matches = textMatches(text, quote, occurrence === undefined ? 2 : occurrence + 1);
    const start = occurrence === undefined ? (matches.length === 1 ? matches[0] : undefined) : matches[occurrence];
    if (start === undefined) return;
    const end = start + normalize(quote).length;
    const highlights = ranges.filter(range => range.end > start && range.start < end);
    for (const { span } of highlights) span.dataset.proofQuote = '';
    return highlights[0]?.span;
}
