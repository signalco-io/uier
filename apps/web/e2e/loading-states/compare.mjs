// Sets the capture run from before the loading-state redesign beside the one after it:
// `node e2e/loading-states/compare.mjs [before] [after] [doc]` (defaults: `playwright-report/loading-states-before`,
// `playwright-report/loading-states`, `../../docs/design/loading-states`). Writes `compare.html` (every design, before
// and after, full size) and `compare-inline.html` (one row per design) into the after folder, and the working document
// (`README.md` with reduced pictures in `assets/`) into the doc folder. What was done about each design is in
// `audit.mjs` (`outcomes`); a design without one is still to do.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { dropped, findings, notCaptured, rules, verdictNames } from './audit.mjs';

const require = createRequire(join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const beforeDir = resolve(process.argv[2] ?? 'playwright-report/loading-states-before');
const afterDir = resolve(process.argv[3] ?? 'playwright-report/loading-states');
const docDir = resolve(process.argv[4] ?? '../../docs/design/loading-states');

/** A run's captures by state id: `{ id, desktop?, mobile? }`, each with the folder it is in */
function readRun(dir) {
    const states = new Map();
    if (!existsSync(dir)) return states;
    for (const file of readdirSync(dir).filter(name => name.startsWith('manifest-')).sort()) {
        for (const entry of JSON.parse(readFileSync(join(dir, file), 'utf8'))) {
            if (dropped.test(entry.id)) continue;
            const state = states.get(entry.id) ?? states.set(entry.id, { id: entry.id }).get(entry.id);
            state[entry.viewport] = { ...entry, dir };
        }
    }
    return states;
}
const before = readRun(beforeDir), after = readRun(afterDir);
const ruleOf = id => rules.find(rule => rule.m.test(id));
const cards = rules.map(rule => ({ ...rule, before: [], after: [] }));
for (const [run, key] of [[before, 'before'], [after, 'after']])
    for (const state of run.values()) cards.find(card => card.m === ruleOf(state.id)?.m)?.[key].push(state);
// The designs are the audit's: one that has no capture from before is not one of them
const shown = cards.filter(card => card.before.length);
const sections = [...new Set(shown.map(card => card.section))];
const lead = state => state?.desktop ?? state?.mobile;
/** `done`: what changed (`open`: what of it is still to do). `skip`: why it stayed. Neither: still to do, or nothing to do for a design that was kept. */
const status = card => card.done ? (card.open ? 'Partly done' : 'Done') : card.skip ? 'Not changed' : card.v === 'keep' && !card.next ? 'Nothing to do' : 'To do';
const tally = name => shown.filter(card => status(card) === name).length;

const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const code = text => escape(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const source = (entry, file) => relative(afterDir, join(entry.dir, file));
/** The after state that answers a before state: the same capture, else the card's first */
const answer = (card, state) => card.after.find(other => other.id === state.id) ?? card.after[0];

// --- compare.html ---------------------------------------------------------------------------------------------------
const figure = (entry, file, caption) => entry && file ? `<figure><button type="button" data-full="${escape(source(entry, file))}" data-caption="${escape(`${entry.title}: ${caption}`)}"><img loading="lazy" src="${escape(source(entry, file))}" alt="${escape(caption)}"></button><figcaption>${escape(caption)}</figcaption></figure>` : '';
const pair = (card, state) => {
    const now = answer(card, state);
    return `<div class="pair">
<div class="side"><h4>Before</h4><div class="shots">${figure(state.desktop, state.desktop?.file, 'Loading, desktop')}${figure(state.mobile, state.mobile?.file, 'Loading, phone')}</div></div>
<div class="side"><h4>After</h4><div class="shots">${now ? `${figure(now.desktop, now.desktop?.file, 'Loading, desktop')}${figure(now.mobile, now.mobile?.file, 'Loading, phone')}${figure(now.desktop, now.desktop?.loaded, 'Loaded, desktop')}` : '<p class="quiet">Not captured in this run.</p>'}</div></div>
</div>`;
};
const article = card => {
    const members = card.all ? card.before : card.before.slice(0, 1);
    const extra = card.after.filter(state => !card.before.some(other => other.id === state.id));
    const more = card.all ? [] : card.after.filter(state => state.id !== answer(card, card.before[0])?.id && card.before.some(other => other.id === state.id));
    const name = status(card);
    return `<article class="card" data-status="${escape(name)}" id="${escape(card.before[0].id)}">
<header><h3>${escape(card.title)}</h3><span class="chip ${card.v}">Was: ${verdictNames[card.v].toLowerCase()}</span><span class="chip status-${name.toLowerCase().replace(/ /g, '-')}">${escape(name)}</span></header>
<p><strong>Was:</strong> ${code(card.why)}</p>
${card.done ? `<p><strong>Done:</strong> ${code(card.done)}</p>${card.open ? `<p><strong>Still open:</strong> ${code(card.open)}</p>` : ''}` : card.skip ? `<p><strong>Not changed:</strong> ${code(card.skip)}</p>` : card.next ? `<p><strong>Next:</strong> ${code(card.next)}</p>` : ''}
${members.map(state => `${members.length > 1 ? `<h4 class="member">${escape(lead(state).title)}</h4>` : ''}${pair(card, state)}`).join('\n')}
${[...extra, ...more].length ? `<h4 class="member">After: ${extra.length ? 'new and ' : ''}other captures of this design</h4><div class="variants">${[...extra, ...more].map(state => `<figure>${figure(lead(state), lead(state).file, lead(state).title)}</figure>`).join('')}</div>` : ''}
</article>`;
};
const strip = (run, ids, captions) => ids.map((id, index) => {
    const [stateId, loaded] = id.split('#');
    const entry = run.get(stateId)?.desktop;
    const file = entry && (loaded ? entry.loaded : entry.file);
    return file ? `<li><img src="${escape(source(entry, file))}" alt="${escape(captions[index])}"><b>${index + 1}. ${escape(captions[index])}</b></li>` : '';
}).join('');
const css = `
:root { --bg: #f6f6f4; --panel: #ffffff; --ink: #17171a; --muted: #62626b; --line: #e2e2dd; --accent: #2b50e4; --shot: #ecece8;
  --eliminate: #b3261e; --redesign: #a35300; --improve: #0b5cad; --keep: #1b6e3a; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #111113; --panel: #19191c; --ink: #ededee; --muted: #a0a0a8; --line: #2b2b30; --accent: #8fa6ff; --shot: #26262a;
  --eliminate: #ff8a80; --redesign: #ffb968; --improve: #86bdf7; --keep: #7fd39b; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1500px; margin: 0 auto; padding: 32px 16px 96px; }
h1 { font-size: 30px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 8px; text-wrap: balance; }
h2 { font-size: 20px; letter-spacing: -0.01em; margin: 56px 0 16px; padding-top: 16px; border-top: 1px solid var(--line); }
h3 { font-size: 17px; margin: 0; } h4 { font-size: 12px; margin: 0 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
h4.member { font-size: 14px; text-transform: none; letter-spacing: 0; color: var(--ink); margin: 20px 0 8px; }
p { margin: 0 0 8px; max-width: 86ch; } code { font: 12.5px ui-monospace, "SF Mono", Menlo, monospace; background: var(--shot); padding: 1px 5px; border-radius: 5px; overflow-wrap: anywhere; }
.lede, .quiet { color: var(--muted); } .lede { font-size: 16px; }
.numbers { display: flex; flex-wrap: wrap; gap: 12px; margin: 24px 0 8px; padding: 0; list-style: none; }
.numbers li { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; min-width: 132px; }
.numbers b { display: block; font-size: 26px; line-height: 1.1; font-variant-numeric: tabular-nums; } .numbers span { color: var(--muted); font-size: 13px; }
.cascade { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 8px 0 20px; padding: 0; list-style: none; }
.cascade li { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px; }
.cascade img { width: 100%; height: auto; display: block; border: 1px solid var(--line); border-radius: 6px; background: #fff; } .cascade b { display: block; margin-top: 8px; font-size: 13px; }
.filters { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; margin: 32px -16px 0; padding: 10px 16px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); }
.filters button { font: inherit; font-size: 13px; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 5px 12px; cursor: pointer; }
.filters button[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
.filters button:focus-visible, figure button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px; margin: 0 0 16px; }
.card header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 8px; }
.chip { font-size: 12px; font-weight: 600; padding: 2px 10px; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
.chip.eliminate { color: var(--eliminate); } .chip.redesign { color: var(--redesign); } .chip.improve { color: var(--improve); } .chip.keep { color: var(--muted); }
.chip.status-done { color: var(--panel); background: var(--keep); border-color: var(--keep); } .chip.status-to-do { color: var(--panel); background: var(--eliminate); border-color: var(--eliminate); }
.chip.status-partly-done { color: var(--panel); background: var(--redesign); border-color: var(--redesign); }
.chip.status-not-changed, .chip.status-nothing-to-do { color: var(--muted); }
.pair { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 16px; margin-top: 12px; }
.side { min-width: 0; border-top: 2px solid var(--line); padding-top: 8px; }
.shots { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; } figure { margin: 0; } figcaption { color: var(--muted); font-size: 12px; margin-top: 4px; }
figure button { display: block; padding: 0; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--shot); cursor: zoom-in; }
.shots img { display: block; width: auto; height: auto; max-height: 250px; max-width: 400px; }
.variants { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; } .variants img { display: block; width: 100%; height: auto; }
table { border-collapse: collapse; width: 100%; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 10px 14px; border-bottom: 1px solid var(--line); } th { font-size: 12px; color: var(--muted); font-weight: 600; } tr:last-child td { border-bottom: 0; }
.scroll { overflow-x: auto; }
dialog { border: 0; padding: 0; background: transparent; max-width: 96vw; max-height: 96vh; } dialog::backdrop { background: rgba(0, 0, 0, 0.78); }
dialog img { display: block; max-width: 96vw; max-height: 88vh; border-radius: 8px; background: #fff; } dialog p { color: #fff; margin: 8px 0 0; font-size: 13px; text-align: center; max-width: none; }
[hidden] { display: none !important; }
@media (max-width: 900px) { .pair { grid-template-columns: minmax(0, 1fr); } .cascade { grid-template-columns: repeat(2, minmax(0, 1fr)); } .shots img { max-height: 200px; max-width: calc(100vw - 76px); } }
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
  for (const card of document.querySelectorAll('.card')) card.hidden = filter.dataset.filter !== 'all' && card.dataset.status !== filter.dataset.filter;
  for (const section of document.querySelectorAll('section[data-section]')) section.hidden = !section.querySelector('.card:not([hidden])');
});
`;
const statuses = ['Done', 'Partly done', 'To do', 'Not changed', 'Nothing to do'].filter(name => tally(name));
const beforeSteps = ['First bytes: bare blocks', 'Language read: a stand-in shell', 'Workspace read: the shell, generic blocks', 'The page'];
const afterSteps = ['First bytes: the frame', 'Language and workspace read: the shell, the page\'s own shell', 'The page'];
writeFileSync(join(afterDir, 'compare.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>uier loading states, before and after</title><style>${css}</style></head>
<body><main>
<h1>Loading states, before and after</h1>
<p class="lede">The ${shown.length} designs of the audit, each as captured before the redesign and now, on a desktop (1440 × 900) and a phone (393 × 851). Light theme, local data, production build of ${new Date().toISOString().slice(0, 10)}.</p>
<ul class="numbers">${statuses.map(name => `<li><b>${tally(name)}</b><span>${escape(name.toLowerCase())}</span></li>`).join('')}<li><b>${after.size}</b><span>states captured now</span></li></ul>
<h2>A full load of Projects</h2>
<p><strong>Before</strong></p><ol class="cascade">${strip(before, ['hard-projects', 'shell-enter', 'soft-projects', 'soft-projects#loaded'], beforeSteps)}</ol>
<p><strong>After</strong></p><ol class="cascade">${strip(after, ['hard-projects', 'soft-projects', 'soft-projects#loaded'], afterSteps)}</ol>
<div class="filters" role="group" aria-label="Show"><button type="button" data-filter="all" aria-pressed="true">All ${shown.length}</button>${statuses.map(name => `<button type="button" data-filter="${escape(name)}" aria-pressed="false">${escape(name)} ${tally(name)}</button>`).join('')}</div>
${sections.map(section => `<section data-section="${escape(section)}"><h2>${escape(section)}</h2>${shown.filter(card => card.section === section).map(article).join('\n')}</section>`).join('\n')}
<section><h2>Seen in the code, not captured</h2>
<div class="scroll"><table><thead><tr><th>State</th><th>Where</th><th>Why not, and what it looks like</th></tr></thead>
<tbody>${notCaptured.map(([state, where, text]) => `<tr><td>${escape(state)}</td><td>${escape(where)}</td><td>${escape(text)}</td></tr>`).join('')}</tbody></table></div></section>
</main><dialog aria-label="Screenshot"><img alt=""><p></p></dialog><script>${script}</script></body></html>`);

// --- Reduced pictures: the inline sheet and the document ------------------------------------------------------------
const reduce = async (entry, file, target, width) => {
    await sharp(join(entry.dir, file)).resize({ width, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 78 }).toFile(target);
    return target;
};
mkdirSync(join(afterDir, 'thumbs-compare'), { recursive: true });
const tiles = [];
for (const card of shown) {
    const was = lead(card.before[0]), now = lead(answer(card, card.before[0]));
    tiles.push({ card,
        was: await reduce(was, was.file, join(afterDir, 'thumbs-compare', `${card.before[0].id}-before.jpg`), 560),
        now: now && await reduce(now, now.file, join(afterDir, 'thumbs-compare', `${card.before[0].id}-after.jpg`), 560) });
}
const inlineCss = `
.sheet { font-size: 14px; line-height: 1.5; } .sheet p { margin: 0 0 8px; } .quiet { color: var(--muted-foreground); }
.sheet h2 { font-size: 15px; margin: 28px 0 10px; padding-top: 14px; border-top: 1px solid var(--border); }
.counts { display: grid; grid-template-columns: repeat(${statuses.length}, minmax(0, 1fr)); gap: 8px; margin: 12px 0 4px; }
.counts div { border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; background: var(--card); }
.counts b { display: block; font-size: 22px; line-height: 1.1; font-variant-numeric: tabular-nums; } .counts span { font-size: 12px; color: var(--muted-foreground); }
.tile { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px; background: var(--card); margin-bottom: 12px; }
.tile h3 { font-size: 13px; margin: 0 0 4px; line-height: 1.3; } .tile p { font-size: 12px; margin: 0 0 8px; color: var(--muted-foreground); }
.two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.two div { min-width: 0; } .two span { display: block; font-size: 11px; color: var(--muted-foreground); margin-bottom: 4px; }
.two .shot { display: flex; align-items: center; justify-content: center; height: 190px; overflow: hidden; border: 1px solid var(--border); border-radius: 6px; background: var(--muted); }
.two img { display: block; width: auto; max-width: 100%; max-height: 100%; }
.tag { display: inline-block; font-size: 11px; font-weight: 600; padding: 0 8px; border-radius: 999px; border: 1px solid currentColor; margin-right: 6px; }
.tag.done { color: var(--success); } .tag.to-do, .tag.partly-done { color: var(--destructive); } .tag.not-changed, .tag.nothing-to-do { color: var(--muted-foreground); }
`;
writeFileSync(join(afterDir, 'compare-inline.html'), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>uier loading states, before and after</title><style>${inlineCss}</style></head><body>
<div class="sheet">
<div class="counts">${statuses.map(name => `<div><b>${tally(name)}</b><span>${escape(name.toLowerCase())}</span></div>`).join('')}</div>
${sections.map(section => `<h2>${escape(section)}</h2>${tiles.filter(tile => tile.card.section === section).map(({ card, was, now }) => {
        const name = status(card);
        return `<div class="tile"><h3><span class="tag ${name.toLowerCase().replace(/ /g, '-')}">${escape(name)}</span>${escape(card.title)}</h3><p>${escape((card.done ?? card.skip ?? card.why).replace(/`/g, ''))}</p><div class="two"><div><span>Before</span><div class="shot"><img src="${escape(was)}" alt="Before"></div></div><div><span>After</span><div class="shot">${now ? `<img src="${escape(now)}" alt="After">` : ''}</div></div></div></div>`;
    }).join('')}`).join('\n')}
</div></body></html>`);

// --- The working document -------------------------------------------------------------------------------------------
rmSync(join(docDir, 'assets'), { recursive: true, force: true });
mkdirSync(join(docDir, 'assets'), { recursive: true });
const asset = async (entry, file, name, width) => { await reduce(entry, file, join(docDir, 'assets', `${name}.jpg`), width); return `assets/${name}.jpg`; };
const plain = text => text.replace(/\|/g, '\\|');
const anchor = (number, title) => `#${number}-${title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-')}`;
const pictures = async (state, side, loaded = false) => {
    const images = [];
    if (state?.desktop) images.push(`<img src="${await asset(state.desktop, state.desktop.file, `${state.id}-${side}-desktop`, 1000)}" width="440" alt="${escape(state.desktop.title)}, desktop, ${side}">`);
    if (state?.mobile) images.push(`<img src="${await asset(state.mobile, state.mobile.file, `${state.id}-${side}-phone`, 400)}" width="118" alt="${escape(state.mobile.title)}, phone, ${side}">`);
    if (loaded && state?.desktop?.loaded) images.push(`<img src="${await asset(state.desktop, state.desktop.loaded, `${state.id}-${side}-loaded`, 1000)}" width="440" alt="${escape(state.desktop.title)}, loaded">`);
    return images.join(' ');
};
const index = [], body = [];
let number = 0;
for (const section of sections) {
    body.push(`## ${section}`, '');
    for (const card of shown.filter(candidate => candidate.section === section)) {
        number++;
        const name = status(card);
        index.push(`| ${number} | [${plain(card.title)}](${anchor(number, card.title)}) | ${verdictNames[card.v]} | ${name} |`);
        body.push(`### ${number}. ${card.title}`, '', `**Was (${verdictNames[card.v].toLowerCase()}).** ${card.why}`, '');
        if (card.done) body.push(`**Done.** ${card.done}`, '', ...card.open ? [`**Still open.** ${card.open}`, ''] : []);
        else if (card.skip) body.push(`**Not changed.** ${card.skip}`, '');
        else if (card.next) body.push(`**Next:** ${card.next}`, '');
        if (card.before.length > 1) body.push(`Covers ${card.before.length} captures: ${card.before.map(state => lead(state).title).join('; ')}.`, '');
        const members = card.all ? card.before : card.before.slice(0, 1);
        for (const state of members) {
            const now = answer(card, state);
            if (members.length > 1) body.push(`**${lead(state).title}**`, '');
            body.push('Before:', '', await pictures(state, 'before'), '');
            if (now && (card.done || card.after.length)) body.push('After (the last picture is the loaded page):', '', await pictures(now, 'after', true), '');
        }
        const added = card.after.filter(state => !card.before.some(other => other.id === state.id));
        for (const state of added) body.push(`After, new capture: ${lead(state).title}`, '', await pictures(state, 'after', true), '');
    }
}
const total = name => `${tally(name)} ${name.toLowerCase()}`;
writeFileSync(join(docDir, 'README.md'), [
    '# Loading states', '',
    `Every state a person can see while something loads in the app, the review toolbar and the browser extension: what it looked like, what was done about it, and what it looks like now. Audited and captured on 2026-11-18 from a production build with local data, light theme, on a desktop (1440 × 900) and a phone (393 × 851); the "after" pictures are of ${new Date().toISOString().slice(0, 10)}.`, '',
    `The audit held ${before.size} states in place and found ${shown.length} distinct designs: ${Object.entries(verdictNames).map(([key, label]) => `${shown.filter(card => card.v === key).length} to ${label.toLowerCase()}`).join(', ')}. Now: ${statuses.map(total).join(', ')}.`, '',
    'The pictures here are reduced. Full size, every route and both sizes: `apps/web/playwright-report/loading-states/compare.html` (before and after) and `index.html` (the current run) after a capture run (see [Capturing again](#capturing-again)).', '',
    '## The rules', '',
    '- **The frame comes first.** What a page shows without its data (its frame, navigation, headings, tabs, section links, view controls) is real UI in the shell. A skeleton fills only a place data goes.',
    '- **A skeleton has the shape of what replaces it**: rows for a list, a titled card for a settings section, outlines for a card grid. One generic block for every page is not a loading state.',
    '- **Nothing appears and then goes away, and nothing moves.** What depends on the data or on the person\'s permissions is not drawn while loading, unless the shell beside it already knows; what is drawn keeps its place and size.',
    '- **No text before the language is known.** The app\'s language comes from the request (the account\'s, else the browser\'s), so the static shell of a full load has icons and bars, never words that would flash in English.',
    '- **One rule for motion**: a shell that a navigation shows at once is still; a placeholder inside a loaded page pulses, and stops with reduced motion.',
    '- **A status says what is loading** in words a person would use, once, in a region of its own; a count is never 0 because nothing has loaded yet.', '',
    'In code: `apps/web/docs/cache-components.md` ("The frame first"), `apps/web/src/components/app/loading/outlines.tsx` (the shapes), `AppBoundary`, `ShellFrame`, `AuthFrame`, `useShellInfo`.', '',
    '## Findings of the audit', '',
    ...findings.map(([title, text], position) => `${position + 1}. **${title}** ${text}`), '',
    '## Work list', '',
    '| # | State | Was | Status |', '| --- | --- | --- | --- |', ...index, '',
    ...body,
    '## Seen in the code, not captured', '',
    '| State | Where | Why not, and what it looks like |', '| --- | --- | --- |',
    ...notCaptured.map(([state, where, text]) => `| ${plain(state)} | ${plain(where)} | ${plain(text)} |`), '',
    '## Capturing again', '',
    'The captures come from `apps/web/e2e/loading-states/` (`playwright.capture.config.ts`), not from the test suites. App routes are held with Next\'s instant-navigation lock, so the build needs the testing API; everything else holds the request a state waits for. A full load\'s loaded picture and a denied address\'s first paint are taken without the lock (a locked document stays at its shell, and a 404 has no prerendered shell to hold). The Usage card (26) loads inside a page that is already there, which no lock holds: it is captured only from a build with a temporary delay in `ProjectUsageSection` (never committed), and otherwise the picture of the last such run is kept.', '',
    '```sh', 'UIER_INSTANT_TEST=1 pnpm build', 'cd apps/web', 'PORT=4604 pnpm exec playwright test --config=playwright.capture.config.ts',
    'node e2e/loading-states/gallery.mjs   # playwright-report/loading-states/index.html: the current run',
    'node e2e/loading-states/compare.mjs   # compare.html beside it, and this document, against loading-states-before',
    'pnpm -w build                         # an ordinary build again: never test or deploy the testing-API build', '```', ''
].join('\n'));
console.log(`${shown.length} designs: ${statuses.map(total).join(', ')} → ${join(afterDir, 'compare.html')}, ${join(docDir, 'README.md')}`);
