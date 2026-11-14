# Device details

The browser, OS and screen a comment was left from, shown after the first message's time
(`components/info/`, `hooks/useHoverPopover.ts`). What the API stores and who receives it:
[the comments API](../../../docs/api.md#comments-api).

## Reading them

- `getDeviceInfo` reads them when feedback or a capture starts. The names come from `src/userAgent.ts`, which
  parses client hints or the user-agent string in the browser and never sends the string.
- `completeDeviceInfo` adds Chromium's high-entropy OS version and model before a post.
- `src/devices.ts` (`@uier/toolbar/devices`) is the vocabulary shared with the app: `browserKind` / `osKind` and
  their marks.
- `src/deviceDetails/` (`@uier/toolbar/device-details`) is the popover's content, shared with the app's
  `CommentDevice` (uier #428): `DeviceDetails`, `deviceTiles`, `BrowserMark` / `OsMark` and the Lucide icons it draws
  inline (`icons.ts`; `@signalco/ui-icons` lacks some, and `lucide-react` is not in the review bundle). It has no UI-kit
  imports and takes every word from the caller; each surface keeps its own popover, time and copy button. The app's
  Tailwind reads its classes through `@source`, so keep them full strings.

## In the thread

`CommentDevice` is the app's `CommentDevice` in the toolbar: after the first message's time, a desktop, tablet or
mobile icon (only when the size is known) and the browser's mark (`BrowserMark` over `src/devices.ts`, a globe
when unknown). It shows only with the API's member-only `reproduction` field.

## The popover

- It opens on hover without moving the focus and stays open after a click. Enter moves the focus in; Escape
  returns it, without closing the thread or the inbox.
- It lists the screen (size, viewport, pixel ratio), the browser and the OS each with its mark, the recorded
  model, input, colour scheme, reduced motion and page language as two-column tiles with an icon each and the app's
  short words (`deviceTiles`, `device.tiles` in the catalogs: Mouse, Theme, Motion Reduced or Standard, Language), the
  capture time, the Reviewed page link and Copy reproduction details. The copied text keeps the full wording.
- Rows and tiles are `bg-accent/70`, not `muted`: `muted` is the popover's own colour in dark.
- Guests and public viewers get the screen row only.
- `useHoverPopover` focuses the first button itself: Radix's first focus fails in a shadow root.
