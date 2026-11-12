/**
 * `@uier/toolbar/editor`: the rich message editor that saves Markdown, shared by the toolbar's composer and the
 * app's (`MarkdownEditor`), and its Markdown bridge (`markdownToDoc`, `docToMarkdown`). See docs/message-markdown.md.
 */
export { MarkdownEditor, type MarkdownEditorHandle, type MarkdownEditorProps, type MentionQuery } from './MarkdownEditor';
export { docToMarkdown, markdownToDoc, type EditorMention } from './markdownDoc';
