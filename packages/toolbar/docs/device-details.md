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

## In the thread

`CommentDevice` is the app's `CommentDevice` in the toolbar: after the first message's time, a desktop, tablet or
mobile icon (only when the size is known) and the browser's mark (`DeviceMark.tsx` over `src/devices.ts`, a globe
when unknown). It shows only with the API's member-only `reproduction` field.

## The popover

- It opens on hover without moving the focus and stays open after a click. Enter moves the focus in; Escape
  returns it, without closing the thread or the inbox.
- It lists the screen (size, viewport, pixel ratio), the browser and the OS each with its mark, the recorded
  model, input, colour scheme, reduced motion and page language (`deviceSettings`), the capture time, the Reviewed
  page link and Copy reproduction details.
- Guests and public viewers get the screen row only.
- `useHoverPopover` focuses the first button itself: Radix's first focus fails in a shadow root.
