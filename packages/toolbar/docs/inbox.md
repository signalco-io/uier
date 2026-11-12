# Inbox

The inbox sidebar (`components/sidebar/`): the site's threads and this page's drafts, in a panel docked like the
page-check panels ([moving and docking](pill-and-options.md#moving-and-docking)). Ink, radius 16. Its threads use
the same layout as a pin's ([threads](comment-thread.md)).

## Title row and filters

From the top:

- The title row. The title is the panel menu (`PanelTitle`, [keyboard](keyboard.md#composites)). The search icon
  (`InboxSearch`) opens the search field in a popover under it, and stays filled while a search applies. Close.
- `LocationPicker`, at full width. It is split like the app's location filter, in the UI kit's `Popper`:
  - on the left, a project's environments, this page (the default, named by its path, with its full address in a
    tooltip), all pages and the sections (`section:/blog`, `@uier/toolbar/page-sections`, shared with the app);
  - on the right, the other pages with their search, where a typed path is a section too;
  - each with its matching count. The two sides stack on narrow screens.
  Environments and how the choice is kept: [anchor recovery](anchor-recovery.md).
- Assigned to me (an outlined toggle) and the unread line (`MarkAllRead`): "N unread", the site's unread threads,
  toggles the unread filter, with Mark all as read beside it. Hidden when nothing is unread. Mark all as read shows
  whenever something is unread: it reads the listed unread threads, or the site's unread list when none is listed
  and no search or Assigned to me applies. The filters sit closer
  together than the title and the tabs.
- The app's status tabs, counted for the chosen pages: Active (the default, everything not done), Done and All.
  The Active statuses menu beside Active chooses Open, In progress or Ready to verify, and the Active tab then
  names the choice ([comment filters](../../../apps/web/docs/comment-filters.md)).

## Drafts

This page's unsent drafts come before the list (`InboxDrafts.tsx`): resume, post or discard each
([several drafts on a page](composer-popovers.md#several-drafts-on-a-page)).

## The list

- `useInboxComments.ts` and `CommentsFilter.tsx`.
- Cards end with Show on page (this page) or a link to their page. An empty "this page" offers the other pages'
  matches. Unread lists all pages.
- The list is virtualized (`@tanstack/react-virtual` over the inbox's scroll area, `VirtualCards`): only the cards
  near the view are rendered and measured, and the card with the focus stays rendered. Each card has
  `aria-posinset`/`aria-setsize` in a `role="feed"` list.
- A project's lists (the site's and this page's) load in pages of 200 as the reader nears the end
  (`useMoreSiteComments`, `useMorePageComments`), following the review API's `next` cursor. Each page is added to
  the cached list, so updates, read cursors and refreshes (which reload as many pages) apply to it as to the
  first. The site list's threads of this page are merged into this page's list ([realtime](realtime.md)). The
  unread list and the public API are one page.

## Tests

`apps/web/e2e/inbox.spec.ts`.
