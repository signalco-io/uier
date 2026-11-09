# Clients

- Clients are workspace documents (`DbClient`: name, description, icon, colour) in the workspace partition;
  projects point to one with `clientId`, and `DbClientName` (`client_name_<sha256>`) keeps names unique. A
  rename is one transaction on the client and its name reservations, so every project follows at once.
  `src/lib/app/clients.ts` owns them: `createProjectWithClient` / `setProjectClient` find or create the
  client by name and rewrite the client document in the same transaction as the project, so `updateClient`
  can delete an unused client (when a rename takes its name) without leaving a project pointing at nothing.
  Older projects have `clientName` only; `ensureProjectClient` moves it to a client on read (in
  `listProjects` and `getProject`, like `ensureProjectPublicId`), and `updateClient` migrates the whole
  workspace first. `projectClientNameSchema` collapses whitespace and clears blank input; the shared limit
  is 80 characters (280 for descriptions). Icons (`clientIcons`, Lucide) and colours (`clientColors`:
  tints of `--brand-accent`, `--brand-success`, `--brand-warning`, `--destructive`; letters stay ink) live
  in `clientAppearance.ts`; `ClientMark` draws the tile. More colours need new brand tokens first.
  Show clients only through visible projects: pages call `listVisibleProjects` first, then `loadClients`,
  and `projectClients` / `clientNames` / `projectClient` keep only clients those projects point to (the
  Clients tab, the sidebar's Workspace link, the suggestions, the filter, cards and the project header). The filter
  value is the client id (`?client=<id>` or `none`); old `name:<name>` links redirect to it. The client
  field (`ClientNameInput`) is free text that suggests existing clients: it is built on
  `src/components/ui/autocomplete.tsx`, Base UI's Autocomplete styled like shadcn's Combobox (shadcn has
  no autocomplete, and Combobox only takes one of its items). Admins edit a client in `ClientEditDialog`
  on the Clients tab (`updateClientAction`) and add one there for chosen projects (`ClientCreateDialog`,
  `createClient`: refuses a name another client with projects uses, in any case, and moves each project to it). Client data belongs to the signed-in app: `reviewProjectDto`
  (the review API's project) and MCP project lists never include it. `e2e/clients.api.spec.ts` covers
  rename, admin-only access, workspace isolation, migration and DTO exclusion; `project-clients.spec.ts`
  and `users.spec.ts` the UI.
