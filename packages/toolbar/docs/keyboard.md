# Keyboard

Everything in the toolbar works with the keyboard: its controls are composites with one tab stop where
they are a set (a toolbar, tabs, a menu), and single-key shortcuts reach the frequent actions. The app
(`apps/web/docs/keyboard.md`) uses the same keys where it has the same actions.

## Shared vocabulary

`src/keyboard.ts` (`@uier/toolbar/keyboard`, pure: no React, no DOM at import) is what the toolbar and the
app share:

- The switch for single-key shortcuts (`shortcutsEnabled`, `setShortcutsEnabled`,
  `subscribeShortcutsEnabled`), kept per browser under `uier:shortcuts-off`. On uier.io the app and the
  toolbar read the same switch. Each bundles its own copy of this module, and a browser sends no `storage`
  event to the window that wrote the value, so `setShortcutsEnabled` also dispatches `uier:shortcuts-change`
  (`shortcutsChangeEvent`, `detail`: on or off) on the window: every copy on the page updates its cached
  value and tells its subscribers; the `storage` event does that for the site's other tabs. WCAG 2.1.4:
  letters can be turned off, the arrows, Enter and Esc always work.
- `uier:shortcuts-off` holds a boolean only: `'true'` while the shortcuts are off, nothing while they are on.
- Which key a press is: `isShortcutPress` (not handled already, not held, not composing, no Ctrl, ⌘ or Alt),
  `shortcutLetter` (the letter on Latin layouts, else the key in its place; no Shift), `isShortcutsHelpKey`
  (`?`), `isSearchKey` (`/`) and `sequenceTimeoutMs` (G, then the next key).
- `isLetterKeyTarget`: the composed event path identifies editable controls and letter-key widgets across
  shadow roots. The toolbar stops at its own host, before any containing page menu; the app uses the same
  guard along with its dialog and toolbar ownership checks.
- `rovingIndex`: where ↑ ↓ ← →, Home and End move the focus among a composite's items. It stops at the ends.

## Composites

`src/focusKeys.ts`:

- `useRovingFocus(ref, { orientation, preferred })`: one tab stop for a group of buttons (the last focused,
  else the preferred, else the first; tab indexes set after every render). The pill's buttons are a
  `role="toolbar"` named "Tools" (← →; the move handle stays its own stop, since its arrows move the pill),
  and the inbox's status tabs (← →, the chosen tab is the stop; Enter or Space chooses). The Active statuses menu button beside
  Active keeps its own tab stop (`data-roving-skip`, outside the arrows, as in the app); its menu moves with ↑ ↓ and Escape closes only the menu.
  So does a panel's title menu (`PanelTitle`, the other panels to show).
- `moveFocusInMenu`: ↑ and ↓, Home and End between the buttons and links of a popover that reads like a menu,
  as its content's `onKeyDown`: Options, a thread's status menu, Thread options, a message's options, Copy, and the people to assign.
  From the popover itself (where Radix leaves the focus in the shadow root) ↓ goes to the first. Text fields
  keep their keys.

## Shortcuts

`CommentsGlobal` handles them on the window (`listenToWindowKeydown`, bubble phase, so a page that handles
a key keeps it), while the toolbar is expanded and the shortcuts are on. `toolbarShortcuts` in
`src/shortcuts.ts` lists them for Options; keep it in step with the handlers.

| Key | What |
| --- | --- |
| C | Point mode, or a comment on the selected text. The page can start the same with `startUierComment()` (the `uier:start-comment` event; uier's app does on its own C, which then starts and never ends point mode) |
| G then I | Opens the inbox (the focus on Close, as when it opens) |
| / | Opens the inbox and its search popover (the search icon in its title row), the field focused with its text selected |
| J, K | The next or the previous thread: the inbox's cards while it is open (focusable, `tabIndex=-1`; the list is virtualized, so `CommentsGlobal` asks it for the card by its index, `data-uier-inbox-index` and `inboxFocusEvent`, and it scrolls to one that is not rendered before focusing it), else the pins' threads in page order. A pin's thread opened this way focuses its messages (`autoOpenReading`), not the reply box, so the keys go on |
| R | The reply box of the thread with the focus (an inbox card's Reply opens it first) |
| S | Moves the focus to that thread's status menu; Enter opens it with the current status focused, ↑ ↓ choose |
| A | Opens the people to assign in that thread, the first focused (`assignShortcutEvent` on the header) |
| ? | Options on the keyboard shortcuts, the heading focused, with the switch |

C in point mode ends it. Add comment names C in its tooltip (a mono `kbd`, `IconTooltip`'s `shortcut`) and in
`aria-keyshortcuts`, and so does the selection toolbar's Add comment ([selected text](point-mode.md#selected-text)).
Options shows the list and the switch where a keyboard is likely, and always while the shortcuts are off
([Options](pill-and-options.md#profile-and-options)).

The list also has the keys of every text box: Enter sends (saves an edit), Shift+Enter adds a line, and the
formatting keys Ctrl/⌘+B bold, +I italic, +Shift+X strikethrough and +E code (`modifierKey` shows ⌘ on Apple
devices, Ctrl elsewhere; the rest of the editor's keys are in its [note](message-editor.md)).

Keyboard events from the toolbar's editable controls and letter-key widgets stop at its host, even when
it is outside a page layer (`modalLayer.ts`). Host-page shortcuts otherwise see the shadow host instead of
the field and may cancel typing, including C in feedback. `listenToWindowKeydown` still receives these
events inside the boundary; non-editable controls and page shortcuts keep their normal behavior.

None act while typing or in a widget whose letters choose an item (`isLetterKeyTarget`), in the toolbar's
dialogs (Options, feedback, an expanded form; a thread's popover keeps the thread keys), while choosing an anchor, or, except
C, in point mode. `src/threadShortcuts.ts` finds the thread: the one with the focus
(`data-uier-thread-scope`: a pin's popover or an inbox card), else the only open thread popover; its
controls are marked `data-uier-thread-header`, `data-uier-status` (the status menu's badge) and `data-uier-reply`. On uier's own app
pages the app takes a key first (its listeners run before the toolbar's) unless the focus is in the toolbar.

## Canvas mode

While drawing ([canvas mode](canvas-mode.md)) the toolbar's single keys rest and the canvas has its own,
handled on the window like them: each tool's letter (V select, P pen, M marker, B brush, L line, A arrow,
R rectangle, O ellipse, D diamond, T text note, X blur, E eraser; only with the shortcuts on, named in each
tool's tooltip), Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl/⌘+Y redo, Delete or Backspace for the selected shape,
and Esc (cancel the drag, then deselect, then leave when nothing is drawn). The drawing surface is a
`role="application"` widget: its letters are the tools, though `isLetterKeyTarget` counts the role as a
letter-key widget everywhere else. Enter on the surface adds the tool's shape in the middle of the window;
every shape is a focusable button whose arrows move it (Shift: 10 px) and Alt+arrows resize it. The tool
panel is a `role="toolbar"` with one tab stop (← →), and the Style popover's choices are radio groups
(arrows).

## Switches in menus

A menu row that turns something on or off (`OptionSwitch` in `ToolbarOptions.tsx`; the single-key
shortcuts' **Shortcuts**) keeps one fixed label, shows a switch at its end with the current state (brand
tokens: filled `primary` when on, an outlined `muted-foreground` track when off) and is a `role="switch"`
button with `aria-checked`, so it is announced as on or off and Enter or Space toggles it. The menu stays
open with the new state. Switches sit in their own group, first, with a separator (`role="separator"`) from
the action rows.

Escape in a new comment or feedback expanded to a modal goes back to its popover; Escape there closes it
([popovers](composer-popovers.md)).

A mouse resting on a pin previews its thread, read-only; the keyboard has no preview: Enter or Space on a focused
pin opens the thread itself, as before, and Escape closes a preview the mouse opened
([hover preview](composer-popovers.md#hover-preview)).

Composers send on Enter and insert a line break on Shift+Enter. No hint under the text box says so
([uier #175](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fprojects%2Fuier00000002&comment=comment_B5Zp66h_oPH67ZI1HAbRV)):
the shortcuts list has both keys, and where a keyboard is likely (`useKeyboardLikely`, `any-pointer: fine`) the text
box is described to screen readers as "Enter to send. Shift+Enter for a new line." Their submit control stays
labelled and uses the plain button variant; on touch input it has a 44px minimum target.
That description is `ComposerFooter`, under every composer: screen-reader-only, with no visible keyboard hint
and no saved-draft line ([drafts](composer-popovers.md#drafts-across-reloads)).

## Tests

`apps/web/e2e/shortcuts.spec.ts` (desktop): C, the Shortcuts switch in Options (↓ in the menu, toggled in place), the pill's tab stop
and arrows, feedback typing alongside a host-page C handler (popover and expanded modal), `?`, G then I,
`/`, the status tabs, J and K between inbox cards, R and S (the status menu).
