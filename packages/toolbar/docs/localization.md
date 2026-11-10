# Toolbar languages

The toolbar is in English, German (Deutsch), French (Français), Spanish (Español), Italian (Italiano) and
Croatian (Hrvatski). The codes are `toolbarLanguages` in `src/languages.ts` (exported as
`@uier/toolbar/languages`, also used by the app's settings and the API).

## Which language shows

`resolveToolbarLanguage`: the person's own choice, else the project's language, else the workspace's,
else English. The settings are in the app ([project settings](../../../apps/web/docs/project-settings.md#toolbar-language)):

- **Workspace default** (Workspace settings → Toolbar language): existing workspaces have none, which is English.
- **Project language** (project Review settings): Workspace default (nothing stored) or a language.
- **The person's choice** (toolbar Options → Language, or Account → Toolbar language): Default goes back to
  the project's language.
  - A guest's choice stays in their browser, per site: `localStorage['uier:toolbar-language']`. It is never sent.
  - A signed-in account's choice is saved to the account (`user.toolbarLanguage`) and follows it to every site:
    `POST /api/review/<code>/language` (a member's review token) or, on uier's own pages, `POST /api/visitor/language`
    (the session). Guests get `401 sign_in_required` before the body is read.

`GET /api/review/<code>` and `GET /api/visitor` send `language: { default, source, preference? }`: the project's
language, where it comes from (`project`, `workspace` or `default`) and, only for a signed-in account, its own choice
(`null` without one). `readToolbarLanguageInfo` reads it defensively: an older API sends none (English), an unknown
code is English.

## The store (`src/i18n/index.ts`)

One store for the page, so the main root, inline threads and code outside React read the same language:

- `useMessages()` in components, `messages()` outside React (announcements, errors built in hooks, `issueGroup`).
- `useToolbarLanguage()` for `Intl` formats (`CommentTime` uses `Intl.RelativeTimeFormat`).
- `useLangAttribute(element)` names the language on the main root and on each inline thread's container.
- `applyLanguageInfo(info)` is called as the review info or visitor response arrives; `forgetAccountLanguage()` on
  sign-out (a guest choice in this browser applies again); `setLanguagePreference` from Options
  (`hooks/useLanguageChoice.ts`, which saves an account's choice optimistically and goes back to the previous one
  when saving fails). Account language choices are disabled until the save settles; a synchronous guard
  also prevents a second choice before React renders, so saves and rollbacks cannot overtake a newer choice.
- A language change re-keys the page checks (`CommentsGlobal`), so open reports show in the new language.

## Catalogs and assets

- `src/i18n/en.ts` is the source: `Messages = typeof en`. Every other catalog is typed `Messages`, so a missing or
  extra string does not build. Functions build strings with numbers and names; counts use `plural()`
  (`src/i18n/plural.ts`, `Intl.PluralRules`); Croatian has three forms (`pluralHr`: one, few, other).
- The on-demand checks' strings are separate (`src/i18n/lazy/*`, `LazyMessages`): `checks/lazy/locale.ts` holds
  English in the audit asset, and before each run `axeLoader.loadAudit()` hands it the toolbar's language and
  that language's check strings.
- **English is part of the review bundle; every other language is its own asset**, `dist/language-<code>.js`
  (`src/i18n/assets/<code>.ts`: the toolbar's and the checks' strings), published content-addressed next to the
  review bundle (`/toolbar/<sha256>.js`) and loaded with SRI like the audit asset (`src/i18n/load.ts`,
  `src/assetScript.ts`, `src/i18n/languageHandoff.ts`). `tsup.config.ts` fills `__UIER_LANGUAGE_ASSETS__` with each
  path and integrity; `apps/web/scripts/copy-toolbar.mjs` publishes them. A language shows once its asset loaded;
  until then, or when it can not load, the toolbar stays in the language it showed, and Options says so (choosing it
  again retries). A project's toolbar waits for the language before it renders (`languageReady()` in
  `ProjectGate`, at most 4 seconds).
- **Packaged clients** (the browser extension) never add remote scripts: the content script bundles the languages
  (`src/i18n/packaged.ts`) and passes `loadLanguage` in its adapters.
- `toolbar-assets.api.spec.ts` checks that each language is its own pinned asset and never in the review script or
  the audit. Keep it that way: importing a non-English catalog from the review bundle adds every reviewer's
  download.

## Writing strings

- Every user-facing string goes through a catalog, in every language, in the same change. Sentence case, short
  sentences, no exclamation marks (BRAND.md). German, French and Croatian use the formal address (Sie, vous, vi);
  Spanish and Italian the informal (tú, tu).
- Brand and product names stay as they are: uier, axe-core, WCAG, Open Graph, robots.txt, HTML element and attribute
  names. Never translate stable machine values: status ids, feedback type ids, check ids and states, storage keys.
- Feedback type names: the built-in names show translated only while the workspace has not renamed them
  (`format.ts` `feedbackTypeText`); custom names show as written.
- Selectors in code and tests never depend on English labels: use `data-uier-*` attributes
  (`data-uier-inbox-button`, `data-uier-close-inbox`, `data-uier-status-tabs`).
- A comment posted from a page check is written in the reviewer's toolbar language, like the reviewer's own words.

## What stays English

- axe-core's rule help and failure text (axe has no Croatian); uier's wording around them is translated.
- What the server writes: Copy issue's export and the feedback context packet, activity entries, email and the app.
- Comment text, names and other content people wrote.

## Tests

`e2e/toolbar-language.api.spec.ts` covers resolution and fallback, validation, admin-only settings and saving or
resetting an account's choice through both APIs; `e2e/toolbar-language.spec.ts` (full suite) a project language
reaching a guest, a guest's choice across a reload and back to Default, and a member's choice in Account.
