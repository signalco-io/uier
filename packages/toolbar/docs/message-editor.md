# Message editor

Every place a person writes a message uses one rich text editor ([uier #290](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fz9tjlbn647k1&comment=comment_ZYXUeIP2kFtRsvOBe6Lzk)):
in the toolbar a new comment, feedback, a reply (on the page and in the inbox) and an edit (`CommentComposer`);
in the app a reply and an edit (`MessageComposer`). The text shows formatted while it is written and is still
saved as Markdown, shown by `MessageMarkdown` as before ([Message Markdown](message-markdown.md)).

## What it does

- Markdown typed while writing becomes formatting: at the start of a paragraph `# ` to `###### ` (a heading),
  `- `, `* ` or `+ ` (a bulleted list), `1. ` (a numbered list from that number), `> ` (a quote), three backticks
  and a space (code) and `---`, `***` or `___` alone (a rule); inline `**bold**` or `__bold__`, `*italic*` or
  `_italic_`, `~~strikethrough~~`, `` `code` `` and `[text](https://…)` once the closing delimiter is typed.
  Backspace right after a change brings the typed characters back, and they stay text.
- Keys (`editor/commands.ts`): Ctrl/⌘+B bold, +I italic, +E code, +Shift+X strikethrough; Ctrl/⌘+Shift+7 a
  numbered list, +Shift+8 a bulleted list, +Shift+9 a quote; Ctrl/⌘+Alt+1 to 3 a heading, +Alt+0 a paragraph;
  Tab and Shift+Tab indent and outdent a list item (only there: elsewhere Tab moves on); Ctrl/⌘+Z undo,
  Ctrl/⌘+Shift+Z (and Ctrl+Y off Apple devices) redo. The shortcut lists name the four formatting keys
  (`toolbarShortcuts`, the app's `ShortcutsDialog`).
- Enter is the form's: it sends or saves, or picks the highlighted mention (`onKeyDown` runs before the editor's
  own keys and returns whether it took the key). Shift+Enter is a new line (`newLine`): a new item in a list (an
  empty one leaves the list), a line break in a paragraph (a second one starts a new paragraph, Markdown's blank
  line), a line in code (a second empty line at its end leaves it), a paragraph after a heading. Escape belongs to
  the page (it closes the popover, collapses the modal, cancels an app edit) unless the form takes it (an open
  mention list); ProseMirror's own handling would cancel it for everyone, so the editor passes it on.
- Pasting (`handlePaste`): plain text is read as Markdown, as a plain text box sent it; Ctrl/⌘+Shift+V pastes it
  as it is. Text from a code editor (HTML with `white-space: pre`) is its text, read as Markdown. Formatted HTML
  from a page keeps what the editor has (bold, lists, links with a safe address, ...). An address pasted over
  selected text links it. An image alone is the form's to attach (`useAttachedImage`'s paste handler), and a
  dropped image file goes to `onImageDrop` (Attach image). Copying puts the Markdown on the clipboard as text.
- The limit (`maxLength`) counts the saved Markdown. Typed, pasted or filled text that would pass it goes in as
  far as it fits, as a textarea's `maxLength` does; other changes over it are not taken.
- Mentions are whole nodes (`mention`, the person's id and `@Name`): the `@` query before the caret goes to
  `onMentionQuery`, `insertMention` puts the person and a space in its place, Backspace after one removes it whole.

## How it is built

- `src/editor/` (`@uier/toolbar/editor`): `schema.ts` (the Markdown subset as nodes and marks, with
  `MessageMarkdown`'s classes, so the text looks like the posted message), `markdownDoc.ts` (Markdown to the
  document and back), `commands.ts` (input rules, keys, `newLine`), `MarkdownEditor.tsx` (the React component).
  The review bundle includes it; the app imports the ESM build (ProseMirror stays an import for its bundler) with
  `React.lazy` in `MessageComposer`, and `CommentCard` preloads it when the open thread can be replied to or
  edited. The app's `global.css` lists `src/editor` as a Tailwind `@source` for the schema's classes.
- Loading parses with the messages' own parser (`parseMarkdown`, which gives heading levels and mention ids for
  this), so the editor reads a message exactly as threads show it. Saving (`docToMarkdown`) writes Markdown that
  reads back as the same document and escapes only what would otherwise become formatting: `2 * 3`, `snake_case`
  and addresses stay as typed; `*word*` typed as text is saved as `\*word\*`; a line that would start a block gets
  a backslash. Mentions are saved as their `@Name` with UTF-16 ranges, the same as before.
- Formatting that overlaps or touches other formatting: marks that start together open the longest lasting first
  (outside), spaces at a mark's edges go outside its delimiters, and a mark that has to close for another one to
  end opens again after it. Delimiters next to each other can join into one run that the parser splits its own way
  (bold `ab` and italic `bc` in `abc` as `**a*b****c*`), so a paragraph or heading with formatting is read back
  (`textblockLines`) and, when it differs, written again with `_` for some of its emphasis (`**a*b***_c_`), then
  with the marks in the schema's order. Plain paragraphs are not read back. Known limits, all from CommonMark:
  emphasis that ends with punctuation right before a letter or a mention cannot close and is saved as typed text,
  and so is bold or italic with strikethrough that starts or ends together inside a word (`a**~~b~~**c`); formatting
  that overlaps inside a word (bold `ab` and italic `bc` in `xabcy`) has no form, so the mark that would open again
  ends there (`x**a*b***cy`); a link whose text is an address shows its real address (the parser's rule); two lists
  of one kind next to each other become one.
- Controlled: `value` and `mentions` in, `onChange(markdown, mentions)` out. A new `value` from outside (sent,
  discarded, a restored draft, another tab) replaces the document; the editor's own changes never do. Drafts keep
  storing the Markdown and the mention ranges (`CommentComposer`'s `setText`, the app's draft stores), so
  `useDrafts` and `@uier/toolbar/drafts` are unchanged.
- The handle: `focus('end')` (a read-only editor still takes the focus, as a read-only textarea does),
  `replaceText` (one undo step: a rewrite's suggestion), `insertMention`, `element`.
- Read-only (`readOnly`: a reply box while its new comment saves, a form while it sends) is `contenteditable=false`
  with `aria-readonly`. A focused element that becomes editable takes the document's selection, so when text has
  been selected on the page in the meantime (Escape, then a selection for the next comment), the editor gives up
  the focus first and the selection stays.
- Touch and mobile: a `contenteditable` with `role="textbox"`, `aria-multiline`, `aria-placeholder`,
  `enterkeyhint`, `autocapitalize`, `autocorrect` and `spellcheck`; 16 px text in the app on phones (no zoom on
  focus). Keys during an IME composition are the composition's, never a shortcut or a send. On Android and iOS
  ProseMirror leaves Enter to the on-screen keyboard and reports it as Enter (it sends); Shift+Enter from a
  hardware keyboard is the editor's. Before a key, the editor reads a selection the page has not reported yet.
- Why ProseMirror, used directly (`prosemirror-model`, `-state`, `-view`, `-transform`, `-commands`, `-keymap`,
  `-history`, `-inputrules`, `-schema-list`): its `contenteditable` handling covers IME, Android, iOS and shadow
  roots, and its schema maps one to one to the Markdown subset; an editor framework on top of it (TipTap) adds
  size without adding to that. The review script grows by about 240 KB (75 KB gzip) to 1.22 MB, so its publish
  limit in `apps/web/scripts/toolbar-assets.mjs` is 1.5 MB; the loader (`dist/index.js`) does not change, and
  ordinary visitors never load the editor.

## Tests

- `apps/web/e2e/message-editor.api.spec.ts`: formatted Markdown read and written back unchanged, overlapping and
  adjacent formatting (bold, italic, strikethrough, code, links and mentions, next to punctuation, in a heading),
  overlap inside a word, a seeded check of formatting on words, typed text that
  only gets the backslashes it needs, heading and list edge cases, mentions in and out of formatting, and a seeded
  check of plain text in risky characters.
- `apps/web/e2e/message-editor.spec.ts` (desktop and mobile): Markdown typed in the toolbar's feedback form, the
  bold key, the Markdown that is sent and the formatted inbox message; Backspace after a change, pasted Markdown
  and the length limit.
- `apps/web/e2e/message-markdown.spec.ts`: the app's reply box (bold as it is typed, a mention after it, code).
- Composer tests read the text with `toHaveText(…, { useInnerText: true })`; `e2e/support/composer.ts` selects a
  range in it (`selectText`, `selectedText`).

Bare URL serialization uses the message parser's URL character range, including hyphens in hosts
and paths. GitLab `/-/merge_requests/` links keep their underscores unescaped so thread PR detection
recognizes them after posting; `message-editor.api.spec.ts` and `pull-requests.spec.ts` cover this.
