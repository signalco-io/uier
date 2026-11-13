# Account and profile pictures

- **Account** (`account/`) uses the same `SettingsLayout` and `Section` cards: General (the account page
  itself: profile (picture and name), appearance, workspace access, which lists only what is set: role, then relationship and teams when
  there are any, then projects), Sign-in (Google, Microsoft, passkeys, sign out; each method's card has its mark
  before the title through `Section`'s `icon`: Google's "G" and Microsoft's logo from `SignInProviderLogos`, the
  same files as the sign-in card's buttons and in the providers' own colours, and `KeyRound` for passkeys, the
  sign-in card's passkey icon), Notifications (each project's emails),
  Usage (the person's own limits, see [Usage](usage.md)) and Coding agents, listed by `accountSections` and linked with `KnownPageLinks.account(section)`. Sign-in returns and
  linking outcomes land on Sign-in, and the breadcrumbs end with the section. A change to `SettingsLayout`
  applies to both settings.
- **Profile pictures** (`lib/app/avatars.ts`, [API](../../../docs/api.md#profile-pictures)): Account's Profile shows the
  avatar left of the name field. The avatar is the button ("Edit profile picture", described by the file types
  note under the row) with a pencil badge on its corner; its menu has Upload picture (Upload a new picture once
  there is one) and Remove picture. There is no separate upload button. Every place that uploads a picture uses the
  same `EditablePicture` and `usePictureUpload` (`components/app/EditablePicture.tsx`): today the profile picture
  and client logos ([clients](clients.md)). Besides the file chooser, the hook's `dropTarget` takes an image dropped on
  the picture or its open menu/popover, or pasted while the focus is in either (never a page-wide clipboard
  listener; text pastes pass through). Both pickers spread it on the trigger and the popup with
  `dropTargetClassName` (a ring while a file is over it). A file of another type gets the server's message
  (`AVATAR_TYPE_ERROR`) before anything is sent; an empty type is left to the server. A drop or paste on the
  profile picture's open menu closes it; one on the closed client avatar opens its popover to show the result.
  Each change saves at once through `POST`/`DELETE /api/account/avatar`
  (a route, not an action: a multipart body, a same-origin `Origin` check, then the session; the page calls
  `router.refresh()`). The shared
  upload parser (`avatarUpload.ts`) and browser downsizing helper (`fitAvatarUpload.ts`) also serve client logos.
  The server sniffs PNG/JPEG/WebP/GIF, caps 4 MB and 25 MP, and Sharp re-encodes a centre square of at most 256 px as WebP.
  The image is a `user-avatar` document in the user's partition, swapped with `user.avatar` in one `transact`
  batch; never write a user document without its etag, or a stale copy drops the reference. `avatarUrl(user)` gives
  `/api/avatars/<userId>/<version>` (random version, immutable, private cache, any signed-in viewer). Show a person
  with `PersonAvatar` (`name`, `avatarUrl`): the initial stays the fallback. Lists get `avatarUrl` from
  `listMembersWithUsers`; comment views only for current project members; the review API and toolbar have none.
  Google and Microsoft sign-in import the provider's picture on a first sign-in or link, only while the account has
  none (`importProviderAvatar`). `avatars.api.spec.ts` and `account-avatar.spec.ts` cover it.

- **Toolbar language** (General, after Appearance; `ToolbarLanguageForm`, `setToolbarLanguageAction`): the review
  toolbar's language on every site the account reviews, the same choice as the toolbar's Options → Language
  (saved through `POST /api/review/<code>/language` or `POST /api/visitor/language`). Project default clears it, so
  each project's language applies (the project's, else its workspace's, else English); see
  [project settings](project-settings.md#toolbar-language). `setUserToolbarLanguage` writes only that field,
  through the user document's etag.

Account section links use Next.js navigation and preserve the document and feedback toolbar pill
(`e2e/app-navigation.spec.ts`). Google/Microsoft account linking still uses provider redirects.
On navigation from Projects, `AccountFrame` renders the title and section links using the shared
layout's current language before the email and forms arrive. The email has its own Suspense boundary
with a one-line UI-kit skeleton; each section retains its existing `PageLoading`. The frame and a
focused section link stay mounted as both regions resolve. Initial document loads keep the outer
request-language and signed-in shell boundaries. `e2e/instant-nav.spec.ts` guards empty/populated
workspaces on desktop, mobile and tablet with the production-build navigation lock.

- **Several signed-in accounts.** The sidebar account menu switches accounts independently of the
  workspace switcher. Add account supports every sign-in method and retains existing accounts,
  up to five. Signing out here or in Account → Sign-in removes the active account and opens another
  live one; the menu's Sign out of all accounts clears them all. Profile, passkeys, provider links,
  workspace access and recent-sign-in/email-proof checks always belong to the active account.
  A fresh sign-in for a protected account action keeps the other accounts signed in. See
  [sign-in](sign-in.md#several-accounts-in-one-browser).
- **Coding tool account selection.** MCP consent can explicitly include any of the browser's five
  signed-in accounts, with a separate workspace/project selection for each. Only the active account
  starts selected; choosing an account does not switch the browser. The active account at approval
  manages the resulting connection in Coding agents, even when it was excluded from project access.
  Its connection details show included profiles and their selections; profile email and project names
  are shown only for accounts currently signed in to that browser. Switching or signing out of browser
  accounts does not revoke the approved MCP connection. Revoke from its managing account ends access
  for all selected profiles. Reconnect and replace it to change the selection. See [MCP connector](mcp-connector.md).

Account controls, profile messages, appearance choices, workspace access and section labels use the [app language](localization.md). App language and Toolbar language are separate saved preferences; native language names remain readable in every language.

Project and review links can offer a signed-in browser account with live access to the target project. The switch page rechecks session expiry, workspace membership and project/team access before selection, then selects that account and workspace and continues to the original path and query. Missing or inaccessible projects retain the ordinary unavailable response. No parked credential authorizes an app read. Coverage: `account-sessions.api.spec.ts` and `account-switching.spec.ts`.

The switch page (`switch-project-account/`) is an `AuthCard` like the other pages outside the shell. Each
account is one row, the submit button of its own form (`AccountChoice`): the profile picture or initial
(`PersonAvatar`, with the name and picture from `getBrowserAccounts`), the name and the email, then a chevron
that becomes a spinner while the switch runs. The email is never truncated, since the domain tells one
person's accounts apart: a long one wraps, before the @ first, and an account whose name is its email shows
it once. Every choice opens the project's own workspace, so the description names it once instead of each
row repeating it ([uier #390](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fswitch-project-account&comment=comment_i1j9YVrhB9l6lP51Qxz9H)).
