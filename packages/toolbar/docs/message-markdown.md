# Message Markdown

Thread messages show their Markdown, in the toolbar (pin popovers and the inbox) and in the app's thread.
What is supported and why is in [Markdown in messages](../../../docs/review-workflow.md#markdown-in-messages).
Writing a message is the [message editor](message-editor.md), which loads and saves Markdown with this parser.

- `src/markdown.ts` (`@uier/toolbar/markdown`, pure, browser and server) parses a message into a small tree:
  paragraphs (line breaks kept), headings (with their level), fenced code, quotes, lists, rules; strong, emphasis, `~~`
  strikethrough, code spans, links, autolinks and bare http(s) URLs. Emphasis follows CommonMark's delimiter
  rules; blocks are line based. It never passes HTML through, refuses every link that is not http, https or
  mailto (`safeHref`), turns images into links, and caps nesting (eight list or quote levels, twelve inline
  levels) so any input stays linear and shallow. `markdownPlainText` gives the words without markers (the app's
  list rows).
- Mentions: each range is swapped for one private use character the text does not contain before parsing,
  so Markdown can neither split a mention nor read a name as Markdown; code shows the name as text. A mention
  given with an `id` keeps it on its node, for the editor.
- `components/MessageMarkdown.tsx` renders the tree with the toolbar's classes; `CommentThreadItem.tsx` passes
  the message text, its mentions (`@` and the current name, Former member for removed accounts) and
  "(edited)", which ends the last paragraph. The app's `MessageMarkdown` renders the same tree: change both
  together. Links open in a new tab with `rel="noopener noreferrer nofollow ugc"` and the full address as their
  title; code is Geist Mono on `bg-muted` with a hairline border (in dark mode a popover is the muted colour);
  everything wraps inside the message (`overflow-wrap: anywhere`, code blocks `pre-wrap`). The message (or the
  kind label, the quote) starts right under the author line, without a gap ([uier #240](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2F5uauxu25b2es&comment=comment__AK3LSckS6SmsHi9Uv11d));
  the parts after it keep the item's 8 px spacing.
- Why not a library: the parser and renderer add about 11 KB minified (5 KB gzip) to the review bundle.
  `marked`'s lexer alone is about 49 KB (15 KB gzip) and still needs a renderer and an HTML policy;
  `markdown-to-jsx` is about 86 KB (31 KB gzip); `micromark` with `mdast` and GFM about 83 KB (24 KB gzip).
  Owning the subset also makes mentions and the link rules part of the parser rather than a pass after it.
- Tests: `apps/web/e2e/message-markdown.api.spec.ts` (every element, refused links, raw HTML, images, mentions,
  adversarial input, both renderers' markup), `apps/web/e2e/message-markdown.spec.ts` (an agent's reply in the
  app and the toolbar inbox, desktop and mobile, with axe).

## Colour swatches

A colour value someone wrote shows a small swatch of that colour just before it ([uier #389](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_ugDRHyvSZBI4uQQdc2BIZ)): in messages and
replies (the toolbar's threads and the app's), in the app's thread titles and row titles, and in the inbox's
draft previews. The text is stored, read, copied and announced as written; only the display adds the swatch.

- `src/colorValues.ts` (`@uier/toolbar/color-values`, pure, browser and server) is the one detector.
  `colorParts(text)` splits a text at its colour values; `cssColor(value)` checks a single one.
  - Hex: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. Functions: `rgb()`, `rgba()`, `hsl()`, `hsla()`, `hwb()`,
    `lab()`, `lch()`, `oklab()`, `oklch()` and `color()` with a predefined space, in the comma and the space
    syntax, with `none` and an alpha. Each is checked for the number and kind of its values, so a mistyped
    value gets no empty swatch.
  - Not colours: names (`red` is a word), `var()`, `calc()`, `color-mix()` and relative colours (no colour of
    their own), and a value joined to other text: a URL fragment (`page#abc`, `/#fff`), an entity (`&#123;`),
    an id (`#add-comment`), a method (`theme.rgb(…)`).
  - `#389` and `#1234` are numbers of comments, issues and pull requests far more often than colours. Three or
    four decimal digits count only when they start with 0 (`#000`, `#0008`) or repeat one digit (`#333`, the
    greys); six and eight digits always count. Change this rule and its test together.
- The swatch's colour comes from text anyone can write, so `color` is never the written text: it is written
  again from the checked parts (hex digits, or a known function name with numbers, units, `none`, commas and
  one slash). Nothing else can reach the `style` attribute; set only `backgroundColor` from it.
- `components/ColorText.tsx` renders the parts, and the app's `comments/ColorText.tsx` renders the same markup:
  change both together. The swatch is a 12 px square with the 4 px tag corner and a `border-border` hairline (a
  colour close to the surface still shows), 4 px before its value, `aria-hidden`, its colour kept in forced
  colours (`forced-color-adjust-none`). It and the value's first
  eight characters do not wrap apart; the rest of a long value wraps like any text.
- Where: text and code spans get swatches (people and agents write colours in backticks most), in every
  block: paragraphs, headings, lists, quotes, link text. Fenced code stays exactly as written: a swatch would
  shift its columns, and a block is there to be read and copied as code. The composer does not show swatches
  while writing, and neither does a title's field. Quoted page text (the selection a comment is on) is the
  page's, not the reviewer's, and gets none. Row titles and draft previews are plain text without blocks
  (`markdownPlainText`), so every value in them gets one.
- Tests: `apps/web/e2e/color-values.api.spec.ts` (what counts, hostile input, both renderers' markup),
  `apps/web/e2e/color-swatches.spec.ts` (rows, titles and messages in the app, the toolbar's thread, with axe).
