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
