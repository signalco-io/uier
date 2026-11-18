// Builds the loading-state gallery inside a capture run's folder: `node e2e/loading-states/gallery.mjs [folder]`
// (default `playwright-report/loading-states`, where the captures go). `index.html` is the full gallery (every capture,
// desktop and phone, beside the loaded page); `inline.html` is a condensed sheet with one thumbnail per design. The
// verdicts below are the audit's judgements, not measurements.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { dropped, findings, notCaptured, rules, verdictNames } from './audit.mjs';

const require = createRequire(join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const captures = resolve(process.argv[2] ?? 'playwright-report/loading-states');
const out = captures;

// --- Read the run ---------------------------------------------------------------------------------------------------
const entries = readdirSync(captures).filter(file => file.startsWith('manifest-')).sort()
    .flatMap(file => JSON.parse(readFileSync(join(captures, file), 'utf8'))).filter(entry => !dropped.test(entry.id));
const hash = file => createHash('md5').update(readFileSync(join(captures, file))).digest('hex');
/** id → { desktop, mobile } */
const states = new Map();
for (const entry of entries) {
    const state = states.get(entry.id) ?? states.set(entry.id, { id: entry.id }).get(entry.id);
    state[entry.viewport] = { ...entry, hash: hash(entry.file) };
}
const cards = rules.map(rule => ({ ...rule, states: [] }));
for (const state of states.values()) {
    const card = cards.find(card => card.m.test(state.id));
    if (!card) { console.warn(`No rule for ${state.id}`); continue; }
    card.states.push(state);
}
const shown = cards.filter(card => card.states.length);
const sections = [...new Set(shown.map(card => card.section))];
const count = verdict => shown.filter(card => card.v === verdict).length;
const captured = entries.length + entries.filter(entry => entry.loaded).length;

// --- Files ----------------------------------------------------------------------------------------------------------
mkdirSync(join(out, 'thumbs'), { recursive: true });
const thumb = async (file, width = 720) => {
    const target = join(out, 'thumbs', `${file.replace(/[/.]/g, '-')}-${width}.jpg`);
    await sharp(join(captures, file)).resize({ width, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 80 }).toFile(target);
    return target;
};

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const lead = state => state.desktop ?? state.mobile;
const describe = entry => {
    const parts = [];
    if (entry.trigger === 'hard') parts.push(`full load of <code>${escape(entry.route)}</code>${entry.http && entry.http !== 200 ? ` (HTTP ${entry.http})` : ''}`);
    else if (entry.trigger === 'soft') parts.push(`<code>${escape(entry.from)}</code> → <code>${escape(entry.route)}</code>`);
    else if (entry.route) parts.push(`<code>${escape(entry.route.replace(/^https?:\/\/[^/]+/, ''))}</code>`);
    const labels = (entry.statuses ?? []).filter(label => /load|check|connect|start/i.test(label) && label.length < 60);
    if (labels.length) parts.push(`status: ${labels.map(label => `“${escape(label)}”`).join(', ')}`);
    else if (entry.trigger !== 'in-page' || entry.surface === 'toolbar') parts.push('no status region');
    if (entry.skeletons?.total) parts.push(`${entry.skeletons.total} skeleton blocks, ${entry.skeletons.animated === 0 ? 'static' : entry.skeletons.animated === entry.skeletons.total ? 'pulsing' : `${entry.skeletons.animated} pulsing`}`);
    return parts.join(' · ');
};

// --- The full gallery -----------------------------------------------------------------------------------------------
const figure = (file, caption, kind) => file ? `<figure class="${kind}"><button type="button" data-full="${escape(file)}" data-caption="${escape(caption)}"><img loading="lazy" src="${escape(file)}" alt="${escape(caption)}"></button><figcaption>${escape(caption)}</figcaption></figure>` : '';
const shots = state => `<div class="shots">${[
    figure(state.desktop?.file, 'Loading, desktop', 'loading'), figure(state.desktop?.loaded, 'Loaded, desktop', 'loaded'),
    figure(state.mobile?.file, 'Loading, phone', 'loading phone'), figure(state.mobile?.loaded, 'Loaded, phone', 'loaded phone')
].join('')}</div>`;
const stateBlock = (state, heading) => `<div class="state">${heading ? `<h4>${escape(lead(state).title)}</h4>` : ''}<p class="meta">${describe(lead(state))}</p>${lead(state).note && lead(state).trigger !== 'in-page' ? `<p class="note">${escape(lead(state).note)}</p>` : ''}${shots(state)}</div>`;
const variant = state => {
    const entry = lead(state);
    return `<figure class="variant"><button type="button" data-full="${escape(entry.file)}" data-caption="${escape(entry.title)}"><img loading="lazy" src="${escape(entry.file)}" alt="${escape(entry.title)}"></button><figcaption>${escape(entry.title)}</figcaption></figure>`;
};
const card = item => {
    // Members with the very same picture are listed once
    const distinct = [], same = [];
    for (const state of item.states) (distinct.some(other => lead(other).hash === lead(state).hash) ? same : distinct).push(state);
    const [first, ...rest] = distinct;
    const titles = item.states.length > 1 ? `<p class="covers">${item.states.length} captures: ${item.states.map(state => escape(lead(state).title)).join(', ')}${same.length ? ` <em>(${same.length + 1} of them are pixel-identical)</em>` : ''}</p>` : '';
    return `<article class="card" data-verdict="${item.v}" id="${escape(first.id)}">
<header><h3>${escape(item.title)}</h3><span class="chip ${item.v}">${verdictNames[item.v]}</span></header>
<p class="why">${code(item.why)}</p>${item.next ? `<p class="next"><strong>Next:</strong> ${code(item.next)}</p>` : ''}${titles}
${stateBlock(first, item.all && rest.length > 0)}
${item.all ? rest.map(state => stateBlock(state, true)).join('') : rest.length ? `<div class="variants">${rest.map(variant).join('')}</div>` : ''}
</article>`;
};
const cascade = ['hard-projects', 'shell-enter', 'soft-projects'].map(id => states.get(id)?.desktop).filter(Boolean);
const cascadeLoaded = states.get('soft-projects')?.desktop?.loaded;
const steps = [['1', 'First bytes', 'The static shell: bare blocks'], ['2', 'Language read', 'A stand-in shell'], ['3', 'Workspace read', 'The real shell, the page\'s fallback'], ['4', 'Page data', 'The page']];
const cascadeFiles = [...cascade.map(entry => entry.file), cascadeLoaded].filter(Boolean);

const css = `
:root { --bg: #f6f6f4; --panel: #ffffff; --ink: #17171a; --muted: #62626b; --line: #e2e2dd; --accent: #2b50e4; --shot: #ecece8;
  --eliminate: #b3261e; --redesign: #a35300; --improve: #0b5cad; --keep: #1b6e3a; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #111113; --panel: #19191c; --ink: #ededee; --muted: #a0a0a8; --line: #2b2b30; --accent: #8fa6ff; --shot: #26262a;
  --eliminate: #ff8a80; --redesign: #ffb968; --improve: #86bdf7; --keep: #7fd39b; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 32px 16px 96px; }
h1 { font-size: 30px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 8px; text-wrap: balance; }
h2 { font-size: 20px; letter-spacing: -0.01em; margin: 56px 0 16px; padding-top: 16px; border-top: 1px solid var(--line); }
h3 { font-size: 17px; margin: 0; } h4 { font-size: 14px; margin: 20px 0 2px; }
p { margin: 0 0 8px; max-width: 78ch; } code { font: 12.5px ui-monospace, "SF Mono", Menlo, monospace; background: var(--shot); padding: 1px 5px; border-radius: 5px; overflow-wrap: anywhere; }
.lede { color: var(--muted); font-size: 16px; }
.numbers { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0 8px; padding: 0; list-style: none; }
.numbers li { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; min-width: 132px; }
.numbers b { display: block; font-size: 26px; line-height: 1.1; font-variant-numeric: tabular-nums; } .numbers span { color: var(--muted); font-size: 13px; }
.cascade { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 16px 0 8px; padding: 0; list-style: none; }
.cascade li { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px; }
.cascade img { width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
.cascade b { display: block; margin-top: 8px; font-size: 13px; } .cascade span { color: var(--muted); font-size: 13px; }
.findings { padding-left: 20px; margin: 0; } .findings li { margin: 0 0 12px; max-width: 86ch; } .findings li span { color: var(--muted); }
.filters { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 32px -16px 0; padding: 10px 16px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); }
.filters button { font: inherit; font-size: 13px; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; cursor: pointer; }
.filters button[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.filters button:focus-visible, .shots button:focus-visible, .variant button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px; margin: 0 0 16px; }
.card header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 8px; }
.chip { font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.chip.eliminate, [data-count="eliminate"] b { color: var(--eliminate); } .chip.redesign, [data-count="redesign"] b { color: var(--redesign); }
.chip.improve, [data-count="improve"] b { color: var(--improve); } .chip.keep, [data-count="keep"] b { color: var(--keep); }
.next { color: var(--ink); } .covers, .meta, .note { color: var(--muted); font-size: 13px; } .meta { margin-top: 12px; }
.shots { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; margin-top: 8px; }
figure { margin: 0; } figcaption { color: var(--muted); font-size: 12px; margin-top: 4px; }
.shots button, .variant button { display: block; padding: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--shot); cursor: zoom-in; }
.shots img { display: block; width: auto; height: auto; max-height: 290px; max-width: 520px; }
.variants { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 16px; }
.variant img { display: block; width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 10px 14px; border-bottom: 1px solid var(--line); } th { font-size: 12px; color: var(--muted); font-weight: 600; } tr:last-child td { border-bottom: 0; }
.scroll { overflow-x: auto; }
dialog { border: 0; padding: 0; background: transparent; max-width: 96vw; max-height: 96vh; } dialog::backdrop { background: rgba(0, 0, 0, 0.78); }
dialog img { display: block; max-width: 96vw; max-height: 88vh; border-radius: 8px; background: #fff; } dialog p { color: #fff; margin: 8px 0 0; font-size: 13px; text-align: center; max-width: none; }
[hidden] { display: none !important; }
@media (max-width: 760px) { .cascade { grid-template-columns: repeat(2, minmax(0, 1fr)); } .shots img { max-height: 200px; max-width: calc(100vw - 76px); } }
`;
const script = `
const viewer = document.querySelector('dialog'), image = viewer.querySelector('img'), caption = viewer.querySelector('p');
document.addEventListener('click', event => {
  const button = event.target.closest('[data-full]');
  if (button) { image.src = button.dataset.full; caption.textContent = button.dataset.caption; viewer.showModal(); }
  else if (event.target === viewer || event.target === image) viewer.close();
  const filter = event.target.closest('[data-filter]');
  if (!filter) return;
  for (const other of document.querySelectorAll('[data-filter]')) other.setAttribute('aria-pressed', String(other === filter));
  const verdict = filter.dataset.filter;
  for (const card of document.querySelectorAll('.card')) card.hidden = verdict !== 'all' && card.dataset.verdict !== verdict;
  for (const section of document.querySelectorAll('section[data-section]')) section.hidden = !section.querySelector('.card:not([hidden])');
});
`;
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>uier loading states</title><style>${css}</style></head>
<body><main>
<h1>Loading states of the app, the toolbar and the extension</h1>
<p class="lede">Every state a person can see while something loads, held in place and captured on a desktop (1440 × 900) and a phone (393 × 851), beside the loaded page. Light theme, local data, production build of ${new Date().toISOString().slice(0, 10)}.</p>
<ul class="numbers">
<li><b>${captured}</b><span>screenshots</span></li>
<li><b>${states.size}</b><span>states held</span></li>
<li><b>${shown.length}</b><span>distinct designs</span></li>
<li data-count="eliminate"><b>${count('eliminate')}</b><span>eliminate</span></li>
<li data-count="redesign"><b>${count('redesign')}</b><span>redesign</span></li>
<li data-count="improve"><b>${count('improve')}</b><span>improve</span></li>
<li data-count="keep"><b>${count('keep')}</b><span>keep</span></li>
</ul>

<h2>What a full load of Projects shows</h2>
<p>Each step is replaced by the next as its data arrives. Steps 1 and 2 are the same for every address in the app.</p>
<ol class="cascade">${cascadeFiles.map((file, index) => `<li><img src="${escape(file)}" alt="${escape(steps[index][2])}"><b>${steps[index][0]}. ${escape(steps[index][1])}</b><span>${escape(steps[index][2])}</span></li>`).join('')}</ol>

<h2>Findings</h2>
<ol class="findings">${findings.map(([title, text]) => `<li><strong>${escape(title)}</strong> <span>${code(text)}</span></li>`).join('')}</ol>

<div class="filters" role="group" aria-label="Show">
<button type="button" data-filter="all" aria-pressed="true">All ${shown.length}</button>
${Object.entries(verdictNames).map(([key, name]) => `<button type="button" data-filter="${key}" aria-pressed="false">${name} ${count(key)}</button>`).join('')}
</div>
${sections.map(section => `<section data-section="${escape(section)}"><h2>${escape(section)}</h2>${shown.filter(item => item.section === section).map(card).join('\n')}</section>`).join('\n')}

<section><h2>Seen in the code, not captured</h2>
<div class="scroll"><table><thead><tr><th>State</th><th>Where</th><th>Why not, and what it looks like</th></tr></thead>
<tbody>${notCaptured.map(([state, where, text]) => `<tr><td>${escape(state)}</td><td>${escape(where)}</td><td>${escape(text)}</td></tr>`).join('')}</tbody></table></div></section>

<section><h2>How these were captured</h2>
<p>App routes: Next's instant-navigation lock (<code>@next/playwright</code>) on a build with the testing API. A full load under the lock shows the static shell; a client navigation under the lock shows the destination's prefetched shell. Each route was entered from a page that makes its own fallback the outermost new boundary.</p>
<p>States inside a page, the toolbar and the extension: the request each state waits for was held open (a thread's detail, a page of comments, a server action, the audit script, the extension worker's answer). One fallback nested in page data (Usage) needed a temporary delay in the server component, since removed.</p>
<p>Run again from <code>apps/web</code>: <code>UIER_INSTANT_TEST=1 pnpm -w build</code>, then <code>PORT=4604 pnpm exec playwright test --config=playwright.capture.config.ts</code> and <code>node e2e/loading-states/gallery.mjs</code>.</p></section>
</main>
<dialog aria-label="Screenshot"><img alt=""><p></p></dialog>
<script>${script}</script>
</body></html>`;
writeFileSync(join(out, 'index.html'), page);

// --- The condensed sheet: one thumbnail per design ------------------------------------------------------------------
const inlineCards = [];
for (const item of shown) {
    const first = lead(item.states[0]);
    inlineCards.push({ item, image: await thumb(first.file, first.viewport === 'mobile' ? 360 : 700) });
}
const cascadeThumbs = [];
for (const file of cascadeFiles) cascadeThumbs.push(await thumb(file, 420));
const inlineCss = `
.sheet { font-size: 14px; line-height: 1.5; }
.sheet h2 { font-size: 15px; margin: 28px 0 10px; padding-top: 14px; border-top: 1px solid var(--border); }
.sheet p { margin: 0 0 8px; } .sheet .quiet { color: var(--muted-foreground); }
.counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0 4px; }
.counts div { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; background: var(--card); }
.counts b { display: block; font-size: 22px; line-height: 1.1; font-variant-numeric: tabular-nums; } .counts span { font-size: 12px; color: var(--muted-foreground); }
.steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.steps img, .tile img { display: block; width: 100%; height: auto; border: 1px solid var(--border); border-radius: 6px; background: #fff; }
.steps b { display: block; font-size: 12px; margin-top: 6px; } .steps span { font-size: 12px; color: var(--muted-foreground); }
.finds { margin: 0; padding-left: 18px; } .finds li { margin-bottom: 6px; }
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.tile { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; background: var(--card); min-width: 0; }
.tile .shot { display: flex; align-items: center; justify-content: center; height: 196px; overflow: hidden; border-radius: 6px; background: var(--muted); }
.tile .shot img { width: auto; max-width: 100%; max-height: 100%; }
.tile h3 { font-size: 13px; margin: 8px 0 4px; line-height: 1.3; } .tile p { font-size: 12px; margin: 0; color: var(--muted-foreground); }
.tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 0 8px; border-radius: 999px; border: 1px solid currentColor; margin-right: 6px; }
.tag.eliminate { color: var(--destructive); } .tag.redesign { color: var(--warning); } .tag.improve { color: var(--info); } .tag.keep { color: var(--success); }
@media (max-width: 520px) { .tiles, .counts, .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;
const inline = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>uier loading states</title><style>${inlineCss}</style></head><body>
<div class="sheet">
<p><strong>${states.size} loading states</strong> held and captured (${captured} screenshots with the loaded pages and the phone size), grouped into ${shown.length} distinct designs.</p>
<div class="counts">${Object.entries(verdictNames).map(([key, name]) => `<div><b>${count(key)}</b><span><span class="tag ${key}">${name}</span></span></div>`).join('')}</div>
<h2>A full load of Projects, step by step</h2>
<div class="steps">${cascadeThumbs.map((file, index) => `<div><img src="${escape(file)}" alt="${escape(steps[index][2])}"><b>${steps[index][0]}. ${escape(steps[index][1])}</b><span>${escape(steps[index][2])}</span></div>`).join('')}</div>
<h2>Findings</h2>
<ol class="finds">${findings.map(([title, text]) => `<li><strong>${escape(title)}</strong> <span class="quiet">${escape(text.replace(/`/g, ''))}</span></li>`).join('')}</ol>
${sections.map(section => `<h2>${escape(section)}</h2><div class="tiles">${inlineCards.filter(({ item }) => item.section === section).map(({ item, image }) => `<div class="tile"><div class="shot"><img src="${escape(image)}" alt="${escape(item.title)}"></div><h3><span class="tag ${item.v}">${verdictNames[item.v]}</span>${escape(item.title)}${item.states.length > 1 ? ` <span class="quiet">(${item.states.length})</span>` : ''}</h3><p>${escape(item.next ?? item.why)}</p></div>`).join('')}</div>`).join('\n')}
</div>
</body></html>`;
writeFileSync(join(out, 'inline.html'), inline);

console.log(`${states.size} states, ${shown.length} designs, ${captured} screenshots → ${join(out, 'index.html')}`);
console.log(Object.keys(verdictNames).map(key => `${key} ${count(key)}`).join(', '));

