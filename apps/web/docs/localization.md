# App languages

The app supports the same languages as the toolbar: English (`en`), German (`de`), French (`fr`),
Spanish (`es`), Italian (`it`) and Croatian (`hr`). The public marketing site and outgoing emails retain
English. Names, comments, project content, copied machine-readable context and code snippets remain as written.

## Language choice

Account → General → App language saves a personal choice to `user.appLanguage`. It follows the active
account across browsers and workspaces. Choosing English explicitly overrides the browser. Browser default
removes the preference: the first supported `Accept-Language` entry by quality and order applies, including
regional variants such as `fr-CA` or `hr-HR`. Unsupported or missing preferences fall back to English.

The app and toolbar language settings are independent. A toolbar choice continues to override the project's
or workspace's toolbar language; it does not change app navigation. App language never changes what another
member sees. Saves validate the language on the server, authorize the active account and update only this
field through the user document's etag. Inputs stay disabled while saving; a failure retains the saved choice.

## Rendering and catalogs

- `src/lib/i18n/languages.ts` shares the supported codes with `@uier/toolbar/languages`; negotiation is pure.
- `getAppI18n()` in `src/lib/i18n/server.ts` resolves the active account and request language. React `cache()`
  deduplicates reads within that render. Locale, account data and request headers have no shared data cache.
- Keep language reads beneath the [Cache Components](cache-components.md) Suspense boundaries. The app's
  static layout streams an `AppLanguage` child which supplies the resolved language and selected catalog.
- `useAppI18n()` supplies `{ t, language }` in client components. Shared public specimens default to English
  without importing catalogs, authentication or live app controls. `lang` is on the app's server-rendered
  container; the provider also updates the document language during navigation and restores it on exit.
- Only the selected catalog crosses the server/client boundary. English uses the source phrases directly
  and sends no redundant dictionary. Non-English dictionaries are imported on the server by language.
- Catalogs live in `src/lib/i18n/catalogs/{common,access,management,comments}`. Each area's `en.ts` lists its
  source phrases; every other locale is typed against those keys. `t('Message with {name}', { name })`
  substitutes named values literally, allowing translated word order. Rich text keeps translated phrases
  around React elements; user text is never passed through the translator.
- Dates, numbers and counts use the selected app language and `Intl` formatters/plural rules. Custom feedback
  type names stay as written; built-in names show translated until renamed. The shared pure PR badge receives
  its translated label from the app caller, keeping the public brand page independent of app locale code.
- Shared history, anchor and access-reason formatters accept an optional translator. Their default English
  preserves existing API/export contracts. The app render and revision endpoint pass the same translator.
- Server actions keep their existing result contracts. At presentation, catalog text and known dynamic
  service-error templates are translated. Interpolated email addresses, domains and names stay unchanged.

When adding app text, add it to all five translations in the same change. Keep machine identifiers, routes,
form field names, schema enums, CSS classes and keyboard keys unchanged. Use formal address in German,
French and Croatian, informal in Spanish and Italian, matching the toolbar's voice.

## Verification

`e2e/app-language.api.spec.ts` checks negotiation, unsupported values, preference persistence and independent
profile/toolbar writes, catalog key/placeholder completeness and localized generated descriptions.
`e2e/app-language.spec.ts` checks every browser language at sign-in, English fallback, profile saves/reloads,
cross-browser account preferences, explicit English, browser reset, navigation and delayed/failed saves.
Feature suites continue to use English by default. Translation catalogs are server resources; do not import
them into a client entry. Preserve the narrow client entry points of settings and access forms.
