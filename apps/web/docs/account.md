# Account and profile pictures

- **Account** (`account/`) uses the same `SettingsLayout` and `Section` cards: General (the account page
  itself: profile (picture and name), appearance, workspace access, which lists only what is set: role, then relationship and teams when
  there are any, then projects), Sign-in (Google, Microsoft, passkeys, sign out; each method's card has its mark
  before the title through `Section`'s `icon`: Google's "G" and Microsoft's logo from `SignInProviderLogos`, the
  same files as the sign-in card's buttons and in the providers' own colours, and `KeyRound` for passkeys, the
  sign-in card's passkey icon), Notifications (each project's emails),
  Usage (the person's own limits, see [Usage](usage.md)), Coding agents and [API tokens](rest-api.md), listed by `accountSections` and linked with `KnownPageLinks.account(section)`. Sign-in returns and
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
  through the user document's etag. Account and toolbar Options both show each choice in its own
  language. `toolbar-language.spec.ts` checks the exact saved label in Account after a toolbar write,
  including when a previous save was delayed or failed.

Account section links use Next.js navigation and preserve the document and feedback toolbar pill
(`e2e/app-navigation.spec.ts`). Google/Microsoft account linking still uses provider redirects.
On navigation from Projects, `AccountFrame` renders the title and section links using the shared
layout's current language before the email and forms arrive. The frame reads nothing from the request
(the language the shell resolved, and the address through the router), so the layout has no boundary
around it. The email has its own Suspense boundary with a one-line bar. The frame and a
focused section link stay mounted as both regions resolve. Initial document loads keep the outer
request-language and signed-in shell boundaries. `e2e/instant-nav.spec.ts` guards empty/populated
workspaces on desktop, mobile and tablet with the production-build navigation lock.

- **Loading** ([loading states](../../../docs/design/loading-states/README.md), 14 and 15). Each section loads in
  its own shape (`components/app/account/AccountLoading.tsx`): its cards with their real titles (`accountTitles`
  in `accountSections.ts`, which the loaded cards read too) on `SectionOutline`, with outlines where the account's
  data goes, and one status per section ("Loading account", "Loading sign-in", "Loading notifications", "Loading
  usage", "Loading coding agents"). General draws its six cards. Sign-in draws Google, Microsoft and Passkeys;
  Sign out needs nothing from the account, so `SignOutSection` is outside the page's boundary and is the real card
  and button from the start. A deployment without Google or Microsoft sign-in has no such card, so there that
  outline goes away when the page arrives (the fallback cannot read the configuration: the shell is built before
  the server's environment is known). Notifications lists the workspace's projects with their marks and names at
  once, as the sidebar has them (`useShellInfo`), and outlines only the switches. Usage draws two projects' meters
  as outlines (the page lists every workspace's projects, which the shell does not know); "Your network" shows only
  while a connection's limit is in use and arrives with the page. Coding agents draws its five cards.

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

Workspace access shows the member's current stored role. Workspace admins change Admin or Commenter
on Workspace → People → Manage access, using the access preview and confirmation; Account's access
summary reflects the saved role and effective grants after refresh.

Project and review links automatically select the only signed-in browser account with live access
to the destination, including its private comment or admin settings permissions. Several eligible
accounts use the existing picker. The switch POST rechecks session expiry, workspace membership
and destination access before selection, then selects that account and workspace and continues to
the original path and query. Missing or inaccessible projects retain the ordinary unavailable
response. No parked credential authorizes an app read. Coverage: `account-sessions.api.spec.ts`
and `account-switching.spec.ts`.

For several eligible accounts, the switch page (`switch-project-account/`) is an `AuthCard` like the other pages outside the shell. Each
account is one row, the submit button of its own form (`AccountChoice`): the profile picture or initial
(`PersonAvatar`, with the name and picture from `getBrowserAccounts`), the name and the email, then a chevron
that becomes a spinner while the switch runs. The email is never truncated, since the domain tells one
person's accounts apart: a long one wraps, before the @ first, and an account whose name is its email shows
it once. Every choice opens the project's own workspace, so the description names it once instead of each
row repeating it ([uier #390](https://uier.io/app/review/uier00000002?url=https%3A%2F%2Fuier.io%2Fapp%2Fswitch-project-account&comment=comment_i1j9YVrhB9l6lP51Qxz9H)).

## Deleting an account

Account → General → Delete account requires the active account’s email and a sign-in within the last
ten minutes (`RECENT_SIGN_IN_SECONDS`, the passkeys’ limit). Deletion drops the active account
from the browser and resumes another signed-in account if present. Signing up again creates a fresh
identity. Project feedback and workspace history follow their normal retention rules.

The card (`DeleteAccountSection`) is the row of a project’s danger zone: what deleting does, then the
button, under the text on a phone. The page tells the dialog whether the sign-in is recent, as it does
for passkeys. With an older one the dialog has no email field: it says why and offers Sign in again,
which comes back to Account. The server checks the time again, so a sign-in that got old while the page
was open turns the dialog into the same state. A request that succeeded keeps the dialog busy until the
browser has left the page.

The service checks every workspace before deleting the user. A shared workspace needs a remaining
admin. A sole member can transfer or explicitly delete projects first. Their project-free workspace
closes with the account. uier’s provisioned feedback workspace always stays open. Every workspace that
needs a handoff comes back in one answer, one line each, and the dialog lists them: nobody is sent back
once per workspace. Nothing is deleted in that case, and the workspaces it had reserved are released.

The user and current avatar are deleted in the same Cosmos transaction that commits the cleanup request.
Cleanup starts after the browser response. The scheduled
worker retries interrupted cleanup and releases abandoned workspace reservations. Cleanup removes
personal credentials, email and provider lookups, memberships, notification settings, read cursors,
personal saved views and old invitation links. A final pass collects in-flight writes. The privacy
contact remains available for scoped erasure of retained feedback and history.

While a deletion prepares and until its cleanup has removed the membership, access changes and new
projects in the person’s workspaces answer “Workspace access is changing. Try again shortly.” That is
normally moments; after an interrupted cleanup it lasts until the worker’s next run. A project transfer
that was still finishing when its old workspace closed settles without that workspace.
