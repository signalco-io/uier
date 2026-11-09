# Project settings

- **Project settings** are sections, each its own page under `settings/` (`settings/layout.tsx`): General (the
  settings page itself), Review, Environments, Installation, People and teams, Integrations, Notifications and
  Danger zone, listed by `projectSettingsSections` and linked with `KnownPageLinks.projectSettings(id, section)`.
  The layout shows them with `SettingsLayout` (`LinkTabs` `side`: a column beside the section, a row above it on
  small screens) and the breadcrumbs end with the section. `settingsContext.ts` loads the viewer and project once per request;
  admin-only sections call `configurableProject` (404 for commenters and the uier workspace). Commenters see
  Installation and Notifications, and the settings page redirects them to Notifications. Integrations is a grid of
  the services not connected yet (logo, one line, Connect, Details) above the connected ones, each a row with its
  destination and status badge; every service has its own page, `settings/integrations/<provider>`
  (`KnownPageLinks.projectIntegration`), with the provider's section: destination, sync controls and privacy limits.
  `components/app/integrations/projectIntegrations.ts` lists the services and computes the status badges both pages
  show. Connect/callback routes return to the provider's page (`?github=connected`); actions revalidate it and the
  overview (`revalidateIntegration`). The settings tabs keep Integrations current on those pages (`nested`). `install` without
  `?onboarding=1` redirects to Settings → Installation (the toolbar still links there).
- **One save per settings page.** General (name, client, [thread titles](ai-titles.md) and rewrite instructions), Review (who can comment, `#who-can-comment`, where the project header's access label leads, with the project's `GuestReviewLinks` under it while the saved access is Anyone with the link and the project has an address, so touch and keyboard users reach them without the hover popover; the brief and, in a collapsed
  Advanced section, the page state) and Environments (the site addresses table) are each one form in one card
  (`ProjectSettingsForms.tsx`) with one server action (`updateProjectGeneralAction`, `updateProjectReviewAction`,
  `updateProjectSitesAction`) that parses every field with the existing schemas before writing, checks the admin role
  (`adminProject`) and the public project (`assertMutableProject`), and writes only what changed. The card footer is
  `SaveFooter` (`components/app/SettingsSave.tsx`): "Unsaved changes", Discard and a Save that stays off until
  something changed; `useSettingsDraft` compares the draft with the saved values and starts over from the server's
  values after a save. Long cards pass `stickyFooter` to `Section`, so Save stays in reach. Switches save at once
  (project emails, comment excerpts); radios and text wait for Save. Account's Profile uses the same footer.
- The board's column sorts are the project's too, but they are chosen on the board, from each column's header, by
  everyone who triages the project, and saved at once ([column sorts](comments-inbox.md#board-column-sorts)).

- **Notifications** (project settings) has two cards: Email notifications (everyone: their own project emails, a switch;
  commenters also read whether emails carry excerpts) and Email content (admins only: Include comment excerpts, the
  unchanged `updateProjectEmailExcerptsAction`). `setProjectEmailsMutedAction` mutes through `setProjectMuted` and
  revalidates the app; Account → Notifications lists every visible project of the workspace with the same switch.

## Workspace defaults and project settings

`src/lib/app/inheritedSettings.ts` is the shared inheritance pattern for settings with additions:

- The workspace document stores the setting's default value. The setting owns its empty default.
- A missing project property means **Workspace default**, with no copy of the workspace value stored.
- A project stores `ProjectSetting<T>`: `{ mode: 'append' | 'replace', value: T }`.
  `replace` uses only the project value, including an intentionally empty string or list.
  `append` combines the current workspace default and the project value in that order.
- `resolveProjectSetting(workspace, project, append)` is pure and shared by previews and server reads.
  Each feature supplies its own merge function: strings join with a blank line; a later list setting
  can concatenate and deduplicate validated items. `projectSettingSchema(valueSchema)` validates the
  persisted shape; the form's `projectSettingModeSchema` also accepts `workspace`, which removes the
  project property. Validate the value and mode before any settings-page write.
- Keep field-specific schemas, defaults, normalization and read projection beside the feature.
  Missing/invalid legacy settings fall back safely. Resolve against the current owning workspace at
  use time: workspace edits affect inheriting/appending projects immediately, including after transfer.
  Do not store computed effective values or put private settings into reviewer DTOs.

### Rewrite instructions

Workspace settings → Rewrite suggestions (`WorkspaceRewriteInstructionsForm`) has an admin-only
plain-text default. Project General (`ProjectRewriteInstructionsFields` within the page's single
save) follows, adds to, or replaces it, and previews the effective instructions. Both use controlled
drafts, Discard and Save; failed saves retain the draft. An empty workspace value clears its default;
an empty project replacement deliberately sends no additional style guidance.

`src/lib/rewrite/settings.ts` owns the 2,000-character limit **per field**, including server validation
and safe reads of stored settings. Appending sends at most 4,002 characters, with the workspace first.
Only admins write through the checked server actions; the workspace service also checks stored
membership. General checks the project in the current workspace and rejects managed public projects.
Older General forms that send no rewrite fields preserve the saved setting. Workspace updates modify
only their setting, retaining access revisions and other defaults.

Both rewrite routes resolve the current project/workspace guidance on the server; the isolated
anonymous showcase has none. Client-supplied settings are ignored. No toolbar, guest page, comment
DTO, MCP export or usage event includes the configuration. Guidance is sent to Anthropic as escaped
user content for tone, terms and style, below the fixed system rules and JSON schema; it cannot
configure models, tools, output shape, limits, retries or accounting. It is stored as a setting;
individual rewrite requests and unused suggestions are not stored.

`rewrite-instructions.api.spec.ts` covers inheritance (also with a validated list), empty/legacy data,
limits, membership checks, stored defaults at the request boundary, prompt delimiter injection and
one content-free accounting event per call. `rewrite-instructions.spec.ts` covers desktop/mobile
save/discard/reload, workspace changes, exact provider guidance through the stub, server validation,
accessibility, guest projection and actual server-action replay as a commenter and signed out.

- **Feedback types** live in Workspace settings and Project settings → Review. Workspaces keep
  `feedbackTypes`; a missing project value inherits live workspace defaults through
  `lib/app/inheritedSettings.ts`, while `{ mode: 'replace', value }` keeps a complete project list.
  Missing workspace settings use Feedback and Bug report. Each list retains those two stable IDs
  (they can be disabled), and supports up to 12 types with distinct names. Custom types use
  `custom_<random id>`, one of eight curated icons, a name up to 40 characters and a required
  placeholder up to 300 characters. No arbitrary SVG, URL or markup is accepted. The type switches
  are part of the list draft and save with the page's Save/Discard footer, alongside the other
  Review settings. New/disabled types do not change pinned comments or suggested rewrites.
  Returning to workspace defaults clears the saved override. Existing forms that send no type
  setting preserve it. Actions check admin/project authority; persistence services validate the
  list again. `feedbackTypeSchema.ts` is the pure input boundary; `feedbackTypes.ts` resolves settings.
- Review info exposes the configured types only to reviewers who can comment. The toolbar shows
  enabled choices; with none enabled it hides Send feedback, while pinned comments remain
  available. New submissions recheck the effective list on the server, reject disabled or foreign
  custom IDs and restrict feedback types to page positions. A successful idempotency retry keeps
  its original receipt even if an admin has since disabled the type. New custom threads capture
  `{ id, label, icon }` in `feedbackType` on the server. Lists, threads, exports and MCP use this saved
  display snapshot, so disabling, renaming, transferring the project or dropping an override cannot
  relabel existing threads. Old built-in threads keep their original kind without a migration.
  `feedback-types.api.spec.ts`, `feedback-types.spec.ts` (desktop/mobile, settings authority, drafts,
  modal writing, accessibility and historical display) and `mcp.api.spec.ts` cover these contracts.

The Review save action checks admin and project authority before parsing feedback types or other
settings, so unauthorized submissions receive the access refusal even when their settings are malformed.
