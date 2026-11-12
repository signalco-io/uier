# Project settings

- **Project settings** are sections, each its own page under `settings/` (`settings/layout.tsx`): General (the
  settings page itself), Review, Environments, Installation, People and teams, Integrations, Notifications and
  Danger zone, listed by `projectSettingsSections` and linked with `KnownPageLinks.projectSettings(id, section)`.
  The layout shows them with `SettingsLayout` (`LinkTabs` `side`: a column beside the section, a row above it on
  small screens; while that row scrolls, an edge fades out as long as more sections are hidden past it) and the breadcrumbs end with the section. `settingsContext.ts` loads the viewer and project once per request;
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
  (`ProjectGeneralForm.tsx`, `ProjectReviewForm.tsx`, `ProjectSitesForm.tsx`) with one server action (`updateProjectGeneralAction`, `updateProjectReviewAction`,
  `updateProjectSitesAction`) that parses every field with the existing schemas before writing, checks the admin role
  (`adminProject`) and the public project (`assertMutableProject`), and writes only what changed. The card footer is
  `SaveFooter` (`components/app/SettingsSave.tsx`): "Unsaved changes", Discard and a Save that stays off until
  something changed; `useSettingsDraft` compares the draft with the saved values and starts over from the server's
  values after a save. Long cards pass `stickyFooter` to `Section`, so Save stays in reach. Switches save at once
  (project emails, comment excerpts); radios and text wait for Save. Account's Profile uses the same footer.
- **Usage** (General, `#usage`) is a grid of label/value cells; each cell spans two rows of the grid (`grid-rows-subgrid`),
  so a label that wraps keeps the numbers of its row on one line.
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

### Toolbar language

The review toolbar's language ([toolbar note](../../../packages/toolbar/docs/localization.md)): English, German,
French, Spanish, Italian or Croatian (`toolbarLanguages` in `@uier/toolbar/languages`). Which one a reviewer sees:
their own choice, else the project's, else the workspace's, else English.

- **Workspace default:** Workspace settings → Toolbar language (`WorkspaceToolbarLanguageForm`,
  `setWorkspaceToolbarLanguageAction` → `setWorkspaceToolbarLanguage`), admins only. Existing workspaces have no
  value, which is English.
- **Project:** Review settings → Toolbar language, in the Review form's one save (`updateProjectReviewAction`,
  admins only, parsed with `projectToolbarLanguageModeSchema` before any write). Workspace default
  (`workspace`) removes the project's value, so a later workspace change applies; the option names the current
  workspace language.
- **Each person:** Account → Toolbar language ([account](account.md)) or the toolbar's Options → Language. Project
  default (`null`) clears it. A guest's choice stays in their browser and is never sent.

Unlike the settings with additions above, this is one value: a missing or unknown project value follows the
workspace, resolved at use time (`toolbarLanguageInfo` in `src/lib/app/toolbarLanguage.ts`). Languages are not
private: `GET /api/review/<code>` and `GET /api/visitor` send the project's language to every reviewer, and a
signed-in account's own choice only to that account ([API](../../../docs/api.md#review-api-a-projects-toolbar)).
The language changes only the toolbar: comments, names and what the server writes (exports, activity, email) stay
as written. `toolbar-language.api.spec.ts` and `toolbar-language.spec.ts` cover it.

### Toolbar features

Review settings → Toolbar features lets project admins simplify the toolbar's optional tools:
Accessibility, SEO, [Security and compliance](../../../packages/toolbar/docs/page-checks-security.md), Text rewrites and Drawing on the page (the toolbar's canvas mode). Comments, page feedback (subject to the existing Feedback types
setting), the inbox and account/options controls stay available. These choices share the Review page's
Save/Discard draft and admin/project checks; they change visibility, not endpoint permissions.

`DbProject.toolbarFeatures` stores independent optional `enabled` and `signedOut` allowlists, using the
stable IDs in `@uier/toolbar/toolbar-features`. Missing lists include current and future tools; an
explicit list, including an empty list or a list containing every current tool, never adds future tools.
“Show all current and future tools” removes the project list. For projects allowing Anyone with the
link, Signed-out reviewers can follow the project tools or choose a smaller list. That list intersects
the project list, never enables a project-hidden tool, and is retained while guest access is off.
Changing who can comment still uses the existing membership rules.

The action and persistence service validate known, unique IDs before any write. Older Review forms
without the field preserve the setting. The review bootstrap projects only the effective list for
the authenticated reviewer; guest responses never contain the member list or the stored configuration.
The toolbar applies it to the desktop pill, mobile Options, restored panels, selection actions and
saved rewrite draft entry points. Hidden checks do not run in the background. Existing threads remain
readable. `toolbar-features.api.spec.ts` and `toolbar-features.spec.ts` cover defaults, fixed lists,
validation, authority, save/discard/reset, guest feedback and desktop/mobile entry points.

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

Settings pages import their own client form entry modules. The email switches and danger-zone
controls are separate from General, Review and Environments, so an account email preference does not
import every project editor. Keep these imports direct rather than adding a client barrel. The
controlled forms share only `keepFormValues.ts` for suppressing React’s action reset.

Project settings and installation copy use the app language from the account preference, then the browser, then English. Toolbar language remains a separate setting: changing the app language never changes a project’s review language. Built-in choices are translated where shown; addresses, environment labels, custom feedback types and project names stay as saved.

## Custom statuses

Workspace settings → Statuses defines up to 30 statuses across the five categories: Open,
In progress, Ready to verify, Done and Archive. Every category keeps at least one status.
Each status has a stable ID, a distinct name (40 characters), an optional description (500
characters), and its position within its category. Move up/down changes that order. Categories
retain their semantic order and colour. Names and descriptions are plain text, never instructions.

`statusWorkflow.ts` owns the browser-safe model and fallback projection; `statusWorkflowSchema.ts`
validates writes and `statusWorkflows.ts` resolves live workspace defaults. Missing/invalid legacy
settings use the five built-ins. `DbProject.statusWorkflow` is either absent (live inheritance) or
`{ mode: 'replace', value }`. Project Review includes the override in its existing Save/Discard
transaction; older forms preserve it. Workspace changes preserve unrelated workspace fields.
Both action paths enforce current admin authority; persistence services validate again.

The configuration chooses the initial status and defaults for Done and Archive actions. New
comments may start only in Open or In progress, keeping them in active lists. Ready to verify
requires a real request and reviewer. Creation retries retain their original saved status. Done, Archive and verification
confirmation resolve current settings, including when an older client sends the existing category
write. No migration changes historical comment categories. Removed/foreign IDs fall back to the
first status in that same category (the configured default for Done/Archive). Archive retains a
separate ordinary ID, so restore preserves the thread's prior custom status.

Custom workflows apply to app settings, board columns, app and toolbar status/archive menus, and MCP reads and writes.
My work keeps its category columns across projects, while its thread menus use each project's
statuses. Board sorts remain shared per category. Same-category moves name the selected status in
activity and MCP events; existing category APIs, filters and verification retain their meanings.
Coverage: `status-workflow{,.api}.spec.ts` and `mcp.api.spec.ts`.

The review API workflow endpoint is member-only. Guests retain ordinary category actions without receiving workspace/project workflow names, descriptions or defaults.

Project Review has **Enable fix verification**, off by default (also when absent on older projects). It participates in Save/Discard, is admin-only, and older forms leave it untouched. Project status editing retains hidden Ready definitions while verification is off. See [the pending-thread behavior](fix-verification.md#project-opt-in).

## Thread labels

Admins define up to 50 labels in Workspace settings → Labels or Project settings → Review → Labels.
Each has a stable `label_<random id>`, a unique name (40 characters), a description (optional, up to
500 characters), an optional curated Lucide icon and a brand-token palette color (Ink by default;
Blue, Sky, Violet, Green, Amber or Red). No arbitrary colors, SVG, URLs or control characters.
The editor uses the page's Save/Discard draft; validation retains failed drafts.

This follows the configurable status workflow's **workspace defaults with project replacement**
pattern: `DbWorkspace.threadLabels` is the default catalog, a missing `DbProject.threadLabels`
follows it live, and `{ mode: 'replace', value: [] }` explicitly chooses no labels. Switching back
to Workspace defaults removes the override. No append mode. `threadLabelSchema.ts` validates
settings actions and persistence; `threadLabels.ts` resolves against the owning workspace.
Old forms preserve the setting. Actions check admin/project authority before parsing; managed
public projects allow label overrides while retaining unrelated settings restrictions.

Thread assignments store IDs only. Renaming/recoloring a definition updates its display; removing
it (including by override or transfer) hides it on existing threads without rewriting them.
Definitions and descriptions are member-only and are omitted from guest review/bootstrap DTOs.
App controls, filtering and MCP share the catalog with toolbar controls and saved board label swim lanes. `thread-labels.api.spec.ts` and `thread-labels.spec.ts` cover these contracts.

The board’s Group by label preference is saved as `DbProject.boardGroupByLabel`, independently of the label catalog and its admin-only settings. It follows the board sort/archive triage authority, including staff-only triage on managed feedback projects; staff admins can manage their label catalogs.

Staff admins can configure workspace labels and project label overrides in uier’s own workspace and feedback projects. Other managed settings remain restricted. Existing triage permissions, member-only catalogs, label filters, toolbar controls, MCP label tools and saved board swim lanes apply there too.
