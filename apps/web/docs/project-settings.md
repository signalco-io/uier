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
- **One save per settings page.** General (name and client), Review (who can comment, the brief and, in a collapsed
  Advanced section, the page state) and Environments (the site addresses table) are each one form in one card
  (`ProjectSettingsForms.tsx`) with one server action (`updateProjectGeneralAction`, `updateProjectReviewAction`,
  `updateProjectSitesAction`) that parses every field with the existing schemas before writing, checks the admin role
  (`adminProject`) and the public project (`assertMutableProject`), and writes only what changed. The card footer is
  `SaveFooter` (`components/app/SettingsSave.tsx`): "Unsaved changes", Discard and a Save that stays off until
  something changed; `useSettingsDraft` compares the draft with the saved values and starts over from the server's
  values after a save. Long cards pass `stickyFooter` to `Section`, so Save stays in reach. Switches save at once
  (project emails, comment excerpts); radios and text wait for Save. Account's Profile uses the same footer.

- **Notifications** (project settings) has two cards: Email notifications (everyone: their own project emails, a switch;
  commenters also read whether emails carry excerpts) and Email content (admins only: Include comment excerpts, the
  unchanged `updateProjectEmailExcerptsAction`). `setProjectEmailsMutedAction` mutes through `setProjectMuted` and
  revalidates the app; Account → Notifications lists every visible project of the workspace with the same switch.
