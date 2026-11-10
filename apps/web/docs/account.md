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
  and client logos ([clients](clients.md)). Each change saves at once through `POST`/`DELETE /api/account/avatar`
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

Account section links use Next.js navigation and preserve the document and feedback toolbar pill
(`e2e/app-navigation.spec.ts`). Google/Microsoft account linking still uses provider redirects.

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
