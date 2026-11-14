# Clients

- Clients are workspace documents (`DbClient`: name, description, icon, colour, optional logo reference)
  in the workspace partition;
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
  in `clientAppearance.ts`; `ClientMark` draws the tile, or its `logoUrl` with the icon/letter as its
  loading and failure fallback. Existing callers may omit `logoUrl`; the project client filter passes
  it to both its menu and trigger, and the sidebar's client groups pass it too (uier #419). More colours need new brand tokens first.
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

- **Client avatar editor**: the avatar in `ClientEditDialog` is an `EditablePicture` (the shared editable picture
  of [profile pictures](account.md): the picture is the button, a pencil badge on its corner) and opens a popover
  with Icon and Colour (saved with the form) and Upload/Change/Remove logo (saved immediately through the shared
  `usePictureUpload`, like profile pictures). A logo can also be dropped on the avatar or the open popover, or pasted
  while the focus is in it; a drop on the closed avatar opens the popover to show its progress and result.
  The optional description has no visibility hint beneath it.
  Uploads and refreshes preserve the unsaved name, description, icon and colour. A logo takes precedence;
  removing it restores the icon/letter and colour. Controls have 44 px touch targets.
- **Logos** (`lib/app/clientLogos.ts`, [API](../../../docs/api.md#client-logos)) share profile pictures'
  `normalizeAvatar`, bounded multipart reader (`avatarUpload.ts`) and browser downsizing (`fitAvatarUpload.ts`):
  PNG/JPEG/WebP/GIF, 4 MB, 25 MP, centre-square WebP up to 256 px, without metadata. The separate
  `client-logo` document (`client_logo_<version>`) and `DbClient.logo` are swapped/deleted in one workspace
  transaction using the client's etag. Detail edits preserve the reference; deleting an unused client
  during a rename also deletes its logo. Transferring a project keeps the destination client's existing
  identity (or creates its icon/colour); a source workspace's private logo URL never moves with it.
  Reads require current workspace membership and access to a live project of that client (direct or
  team access, including done projects), regardless of the selected workspace cookie. Missing, hidden,
  replaced and removed images return 404. Writes recheck admin authority and visibility on conflict retries,
  require same-origin session requests and allow 30 logo changes per person per hour. Image URLs have a
  random immutable version and private caching, same as profile pictures. No image bytes or references
  enter review/MCP DTOs. `client-logos.api.spec.ts` covers authorization, validation, replacement/removal,
  conditional conflicts and cleanup; `project-clients.spec.ts` covers the popover and displayed marks.

Client controls, built-in icon/colour labels and empty states follow the app language. Client names, descriptions and chosen environment labels remain user content and are never translated. Mixed client/project pickers translate only their built-in options before appending saved names.

Following a project link across accounts selects its authorized workspace before loading client data; account offers expose only the accessible account email and workspace name.
