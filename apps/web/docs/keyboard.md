# Keyboard navigation and shortcuts

The app works with the keyboard alone. Sets of controls are composites with one tab stop and arrow keys (a
roving tab index), like the comments list was first; single-key shortcuts reach the frequent actions and
list themselves on `?`. The review toolbar does the same with its own keys
([toolbar keyboard](../../../packages/toolbar/docs/keyboard.md)).

## Composites

| Where | Keys | Code |
| --- | --- | --- |
| Comments list | ↓ ↑, Home, End; Enter opens ([inbox](comments-inbox.md)) | `CommentInbox` |
| Board | ↓ ↑ in a column, ← → to the next column with cards (the card in the same place, or its last), Home and End in the column, Enter opens, M moves | `CommentBoard` |
| My work | ↓ ↑, Home, End in each list; Enter opens | `MyWorkList` |
| Sidebar navigation | ↓ ↑, Home, End between its links (its group's buttons keep their own stops) | `AppSidebar` |
| `LinkTabs` (project, workspace, settings sections, segmented filters) | ← →, Home, End (↑ ↓ too for `side`); Enter opens | `LinkTabs` |
| Toggle groups (List and Board, status tabs), menus, selects, dialogs | the UI kit's own (Base UI) | `components/ui` |

The tab stop is the item last focused, else the current one (the open thread, the current page or tab), else
the first; the keys stop at the ends. A list's other controls (a row's selection box, a card's Move and
avatars) are in the Tab order only in the current row or card. A board column's sort, where the person may
change it, is its own stop in the column's header, before the column's cards ([column sorts](comments-inbox.md#board-column-sorts)). `useRovingTabStop` (`keyboard/keys.ts`) is the
hook for lists of links: `itemProps(key)` on each item, `containerProps` on the composite.

## Shortcuts

`keyboard/AppShortcuts.tsx` is in the shell layout. `useKeyShortcuts` adds a component's own (letters by
handler): it listens on the document in the bubble phase, after React's handlers, so a key a control used
(M on a card) stays its own.

| Key | What | Where |
| --- | --- | --- |
| ? | The shortcuts dialog (`ShortcutsDialog`; also the account menu's Keyboard shortcuts) | everywhere |
| / | The page's search (an input marked `data-shortcut-search`, the first visible) | Comments, Teams |
| C | Comment on this page: uier's own toolbar starts placing a comment, as its + button does (`startToolbarComment`); Give feedback keeps opening its feedback form | everywhere |
| G then I, B | The project's comments as the list or the board; in place on its comments page (keeps the filters) | a project's pages |
| G then M, P | My work, Projects | everywhere |
| J, K | The next or the previous thread: the list opens it (in the thread's place on a phone too), the board focuses the card or opens its thread in the sheet, My work focuses the row | Comments, My work |
| R, S, A | Reply, the status menu, the assignee menu of the open thread (`CommentCard`; menus open as Enter opens them; R focuses the reply box through its ref, never the card's first textarea, since a message editor can be open too) | the open thread |
| X, Ctrl or ⌘ + A, Esc | Select ([triage](triage.md#selection)) | Comments |

- They never act with Ctrl, ⌘ or Alt, when held, while typing, in a menu, a list of options or a dialog
  (`ownsKeys`; the board's thread sheet is marked `data-shortcuts`, so the thread's keys work in it), or in the
  review toolbar (`#uier-toolbar`: its keys are its own). The guard follows the event's composed path, so this
  also holds for fields and dialogs inside shadow roots. Editable and typeahead widgets use the same
  `isLetterKeyTarget` guard as the toolbar (`@uier/toolbar/keyboard`); shortcuts never compete across the app
  and toolbar. They never act on a key the page already handled.
- The key after G is taken in the capture phase, before the focused control's own handling of the letter.
- The controls they press name them with `aria-keyshortcuts` (`useKeyShortcutLabel`: only while they are on).
- Single-key shortcuts can be turned off (WCAG 2.1.4): the switch in the dialog sets `uier:shortcuts-off`
  through `@uier/toolbar/keyboard`, the same switch as the toolbar's. Turned on or off on either side, the
  other follows on the same page (the `uier:shortcuts-change` window event) and in the site's other tabs. The arrows, Enter, Esc and the keys with
  Ctrl or ⌘ keep working; the account menu still opens the dialog.
- The dialog lists every shortcut by where it works (`groups` in `ShortcutsDialog.tsx`); keep it in step with the
  handlers. "The open thread" also has the shared composer's keys (Enter sends or saves, Shift+Enter adds a line, Esc
  cancels an edit or closes an empty reply box), which no hint under the text box repeats ([thread](comment-thread.md)). Keys print in Geist Mono (`Kbd`, BRAND.md: mono means machine); symbols have their names for screen
  readers.

The app has one notification region (Sonner), including its Alt+T focus shortcut; the shared
signalco container is disabled there so screen readers do not find duplicate notification landmarks.

## Tests

`e2e/app-keyboard.spec.ts` (desktop, full suite): the board's tab stop, arrows, J and K in the sheet, S and R;
the list's J and K from the thread, R, S, A, `/`, `?`, the switch and the account menu; the switch turned off
in the app's dialog stops the toolbar's letters on the page and the other way round; the sidebar, My work and
the workspace tabs, and G with I, B, M and P. `e2e/comment-keyboard.spec.ts` covers the list's arrows.
The app/toolbar switch case also covers feedback typing and nested shadow-root textareas and contenteditable controls while shortcuts are enabled.

Shortcut descriptions, group headings, symbol names and the single-key setting use the [app language](localization.md). Printed key values and shortcut handlers stay unchanged.
