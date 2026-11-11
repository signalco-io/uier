# Filter and sort component plan

Proposed component contracts, 11 November 2026. Planning only. Implements the
[interaction guidelines](README.md) using the [Cosmos-first backend plan](azure-primitives-plan.md).
The [shared query contract](backend-plan.md#versioned-query-contract) also applies to this adapter.
Follow the [current delivery sequence](azure-primitives-plan.md#revised-execution-sequence);
the PostgreSQL execution plan is a contingent alternative. The precise temporal snapshot protocol
below applies only to that alternative; Cosmos result sessions have the semantics described in
the current backend plan.

## Toolkit decisions

The app is `base-vega`, Base UI, React Server Components, Tailwind v4, Lucide and
`@/src/components/ui` imports. Source files and [components.json](../../../apps/web/components.json)
are authoritative; `shadcn info` currently misdetects the framework as next-pages despite that
configuration. Do not change the app architecture or brand from that generated detection.

Verified with the project CLI on 11 November: `info --json`, official `docs` for combobox,
command, popover, field, sheet and calendar, and registry searches. The official registry returned
no complete filter-builder item. Its sortable search returned a dashboard block, not a dedicated
sort-rule primitive. No components or dependencies were installed for this planning work.

| Need | Existing source / upstream availability | Decision |
| --- | --- | --- |
| Buttons, text fields, menus, status toggles | App already has Button, Input/InputGroup, Checkbox, Select, RadioGroup, ToggleGroup, DropdownMenu, Badge, Avatar, Tooltip | Reuse; no replacement primitives |
| Overlay and grouped forms | App already has Popover, Dialog, Sheet, Collapsible, Field/FieldSet, Separator | Compose these; Base UI `render`, titled overlays and existing focus APIs |
| Searchable ID selection | App has a free-text Autocomplete; official Base UI shadcn Combobox supports item values and multiple selection | Add official Combobox wrapper. Autocomplete is not an assignee-ID selector |
| Date and date range input | Calendar wrapper is absent; official Date Picker is a Popover + Calendar composition, not a standalone registry item | Add Calendar for the app; compose DateValueEditor with presets, text/native date entry and a calendar. Never run `add date-picker` |
| Command palette | Official Command exists and uses cmdk; absent locally | Not required for the query editor. Use it only if a separate action palette is later justified |
| Sort-rule reordering | App declares dnd-kit core; no sortable wrapper/dependency. Toolbar has neither | Custom domain rule list with Move up/down. Optional app drag handle after accessibility; no dashboard/data-table block |
| Long lists/options | Neither surface declares a virtualizer. Base UI documents integration with an external virtualizer | Cursor pages first; add measured windowing for accumulated rows/options, with focus retention |
| Error/loading/empty UI | App already has Empty, Alert, Skeleton, Spinner, sonner; toolbar has its own notices/toasts/announcer | Reuse. App repository rules explicitly retain sonner despite generic skill defaults |

Sources: [shadcn Base UI Combobox](https://ui.shadcn.com/docs/components/base/combobox),
[Base UI Combobox, including virtualization](https://base-ui.com/react/components/combobox),
[Date Picker composition](https://ui.shadcn.com/docs/components/base/date-picker),
[Calendar](https://ui.shadcn.com/docs/components/base/calendar),
[Command](https://ui.shadcn.com/docs/components/base/command),
[Popover](https://ui.shadcn.com/docs/components/base/popover),
[Field](https://ui.shadcn.com/docs/components/base/field),
[Sheet](https://ui.shadcn.com/docs/components/base/sheet).

The toolbar continues with `@signalco/ui` / `@signalco/ui-primitives`, its `Popper`, existing
Input/Button/IconButton and native controls where appropriate. Share semantics and option
rendering data, not app shadcn components, Base UI, cmdk or a second overlay system. Dates can use
native date/range inputs plus the same presets without introducing the app calendar dependency.
See [toolbar dependencies](../../../packages/toolbar/package.json) and
[toolbar component rules](../../../packages/toolbar/AGENTS.md).

At implementation time, recheck registry output and package APIs against the pinned versions,
then add missing official wrappers from `apps/web` with the project package runner. Review the
resulting files and lockfile. No `add --all`, preset replacement, third-party query-builder or
new generic data-table framework is needed.

## Ownership and boundaries

| Layer | Responsibility | Must not own |
| --- | --- | --- |
| `@uier/comments-query` pure package | Wire types, field/operator IDs, normalization, validation, immutable reducer helpers, typed summaries, legacy migration and test oracle | React, localized strings/icons, HTTP credentials, SQL, browser storage |
| `useCommentQueryController` per surface | Active document, drafts, resolved location, query keys, cancellation, URL/memory adapter, capabilities and actions | SQL, independent filtering semantics, membership decisions |
| App adapter | shadcn composition, app URL/SSR, app tokens/theme, router Back/Forward | Toolbar runtime imports or a second query model |
| Toolbar adapter | Signalco composition, ink/shadow-root portals, in-memory navigation, six-language catalogs, extension transport | Host-site filter URLs/storage or app component imports |
| Server query service | Authorization, AST compilation, paging, exact aggregates, options, saved-view concurrency and projection freshness | Trusting UI capabilities or client role/viewer values |

Suggested pure package entries: `/contract`, `/registry`, `/normalize`, `/validate`, `/reduce`,
`/summary`, `/legacy` and `/evaluate`. Keep server-only SQL in `apps/web/src/lib/commentQuery`.
Client summaries are semantic tokens (`field`, `operator`, value IDs, counts), localized by the
surface. A server-issued capability set constrains the registry, but the server revalidates every
request. An unsupported saved condition blocks that view rather than silently disappearing.

## Components to create or evolve

The names below are proposed module boundaries, not new generic primitives. Keep a shared
headless contract with separate app/toolbar renderers where their toolkits differ.

| Component | Function and behavior | App composition | Toolbar composition |
| --- | --- | --- | --- |
| `CommentsQueryBar` / `InboxQueryBar` | Layout for search, visible location, Filter/count, Sort/summary and layout switch. No hidden query state | Evolve CommentFilters; InputGroup, Button, Badge, ToggleGroup | Evolve sidebar header; existing Input/Row/Stack, Button/IconButton and IconTooltip |
| `QuerySearchInput` | Immediate text echo; 100 ms network debounce, IME-safe; clear/Enter flush; retains focus | InputGroupInput + addon clear/loading action | Existing Input and stable decorators |
| `FilterMenu` | Entry to common properties, value search and Advanced filter; independent menu search, property→operator/value navigation | Popover + Combobox/option groups | Popper + existing searchable option-panel pattern |
| `FilterFieldPicker` | Small local authorized field catalog, icons/labels/types; choosing another field clears incompatible values | Combobox or finite choices in Popover | Popper option buttons with existing focus helpers |
| `FilterOperatorPicker` | Type-specific operators; empty/not-empty hides and clears the value editor; operator changes retain a compatible value | Select with SelectGroup/items or menu radio group | Selected option buttons in Popper |
| `ConditionChip` | Readable property/operator/value; edit and clear are separate actions; full accessible name despite truncation | Neutral chip container with sibling Buttons, existing flags/dots/avatars | Equivalent sibling signalco controls; separate from shortcut Toggle |
| `EnumValuePicker` | Multi-select small fixed sets; each choice applies without closing; empty selection removes the rule | Popover, FieldSet/FieldLegend, Checkbox, StateDot/PriorityFlag | Popper and existing checkbox/pressed-option pattern with status/priority renderers |
| `AsyncEntityValuePicker` | Paged authorized people/project/type options; IDs as values; selected items retained across searches; separate loading/empty/error | New Combobox, Avatar, option renderer, load-more/virtualized list when needed | Existing Popper/Input/option primitives with selected summary and paging |
| `LocationScopePicker` | Environment plus current/all/exact/section pages; server-backed options; current page is symbolic, exact page fixed | Adapt LocationFilter | Adapt LocationPicker; preserve ink portal and canonical path behavior |
| `TextValueEditor` / `NumberValueEditor` | Literal text or numeric bounds; values validated by field/operator; incomplete ranges remain a draft | Field + Input/InputGroup | Existing inputs and inline validation |
| `DateValueEditor` | Relative presets, timezone, single date/range, clear; retains relative expression until resolution; both bounds required | Field + Select/Input; Popover + new Calendar for calendar interaction | Preset panel plus native date inputs, same range/timezone contract |
| `AdvancedFilterEditor` | Own advanced draft, Apply/Cancel and validity; no active-query mutation while half-edited | Titled Dialog on wide screens; Sheet on narrow screens | Panel-contained editor; generalized existing native-dialog/top-layer shell on phones |
| `ConditionGroup` | Recursive All/Any, explicit NOT wrapper, child boundaries, add/group/remove; stable IDs and focus recovery | FieldSet/FieldLegend, ToggleGroup/Select, Collapsible, Buttons | Equivalent grouped primitives and buttons; no nested edge-overflowing flyouts |
| `ConditionRow` | Field/operator/value dispatch, per-row error, move/group/remove actions; does not own network state | FieldGroup/Field/FieldError + the editor selected by the registry | Existing field/input/button composition, localized errors |
| `QuerySummary` | Flat chips for simple AND rules; explicit advanced summary for grouped logic; condition count excludes location/order | Chip row, wrap under header on small widths | First two chips + `+N conditions` control, never hide the active-filter indication |
| `SortMenu` / `SortRuleRow` | Ordered distinct scalar rules; field + direction; add/remove; optional project-column fallback summary | Popover/Sheet, Select, Buttons, Separator | Popper/panel, existing selection/button primitives |
| `SortRuleReorder` | Move up/down, numbered priority, focus by rule ID, polite position announcement; optional pointer drag | Buttons first; optional dnd-kit integration, add sortable only if justified | Move buttons provide complete order-changing functionality |
| `QueryResultsState` | Loading/stale/failure/no matches/not-ready; scoped Clear filters/Retry; controls stay mounted | Empty, Alert, Spinner/Skeleton, live region | Existing error/announcer/notice helpers |
| `CommentSummaryList` / `QueryBoardColumn` | Render compact page DTOs, independent column cursor/count, detail on open; append pages without a full reload | Adapt existing list/board, Load more Button; measured windowing | Adapt inbox deferred list; same explicit continuation |
| `SavedViewMenu` / `SaveViewDialog` | Personal/shared names, dirty overrides, save/update/duplicate/reset/delete, ETag conflict; sharing is explicit | DropdownMenu + Dialog + Field/Input/Select; AlertDialog for deletion | Popper + generalized named form shell; authenticated uier-owned persistence |
| `CopyQueryLink` | Encode a small query in a uier URL or persist a scope-protected query reference for a larger one; never grants access | Existing copy action/feedback patterns | Copy a uier-owned review link, not host-site query state |

Keep `AsyncEntityValuePicker` read-only with respect to feedback. The existing
[AssigneesControl](../../../apps/web/src/components/app/comments/AssigneesControl.tsx) mutates
assignments: reuse its person/checkbox presentation, not its mutation controller.

The current [app FilterChip](../../../apps/web/src/components/app/comments/CommentFilters.tsx)
is one clear button. Editable chips require two **sibling** interactive controls; do not place
a clear button inside an edit button. The toolbar's existing
[FilterChip](../../../packages/toolbar/src/components/sidebar/CommentsSidebarHeader.tsx) is an
on/off shortcut; retain that role separately from a condition chip.

## Controller and interaction state

One controller owns the active query, quick-search draft, optional advanced/sort drafts,
selected view reference, current capabilities and request generation. Keep layout/default
preferences separate from the semantic query where appropriate. Wire-document IDs and stable
editor IDs must not be confused when hashing queries or restoring focus.

| User event | State transition | Network / persistence |
| --- | --- | --- |
| Type collection search | Update input immediately; commit after 100 ms idle; suppress intermediate IME composition | Abort obsolete query; one new page-one request; app replace-URL, toolbar memory |
| Enter / clear search | Commit immediately, cancel pending debounce | Page one immediately; do not submit an outer form |
| Choose a complete simple condition | Update one normalized rule; keep the multi-select open | Page one immediately; deduplicate identical normalized query |
| Open advanced editor | Copy active expression into an editor draft | No query until Apply; optional preview must be separately marked/debounced |
| Add/change incomplete advanced row | Preserve entered values and inline errors | No active-query change, no result count presented as applied |
| Apply advanced / sort | Validate complete draft, commit atomically, close/return focus | Page one; explicit user action pushes app history |
| Escape / Cancel advanced | Discard the uncommitted draft; preserve active results | No request; do not propagate Escape into the reviewed page |
| Reorder a sort rule | Move stable rule ID; announce its position; prevent duplicate fields | Commit on editor Apply; quick single-field choice may apply immediately |
| Switch List/Board | Change renderer; retain query and explicit order | Reuse data/query document; fetch needed column pages, not all comments |
| Change page during SPA review | Resolve only the symbolic This page condition | Query new canonical page; exact selected pages remain fixed |
| Open unread result | Pin the authorized detail while its read receipt advances | Mark read using existing mutation path, fence new unread query with receipt version |
| Back/Forward in app | Restore saved normalized query/evaluation context and layout | Cancel obsolete work, reuse only authorized matching cache |
| Access/account/project change | Drop rows, counts, options, drafts containing restricted values and detail for previous identity | Abort all old requests and reauthorize before new data renders |
| Projection not ready / query timeout | Keep valid controls and last same-scope authorized results visibly stale | Retry with bounded backoff/hint; never claim a complete empty set |
| Ordinary updates while loading another page | Keep live indexed paging or the retained complete-evaluation order; show Refresh results | Use stable ties/deduplication. Only the PostgreSQL alternative promises an application-temporal epoch |
| Session expiry or privacy/purge generation change | Expire/purge that session, close restricted detail and restart with current access | No historical redacted data; preserve only still-authorized drafts/focus |

For simple sorts, show `Priority ↓ +1` outside the menu. Direction labels inside are descriptive
and field-specific. Project column order is a distinct fallback, not an empty personal sort.
For complex filters, the summary opens the actual group tree; it must not flatten OR/NOT to AND.
Clear filters and Reset view retain the separate meanings in the design guidelines.

Ordinary realtime changes indicate that fresher results are available. Explicit Refresh or an
own mutation that changes query membership/order reruns the query and replaces any retained
evaluation. Opening an unread row retains its authorized detail while its read badge changes.
A retained result count is labelled as that evaluation's count until refreshed; indexed live
counts are separately evaluated and may move with activity. Keep the toolbar's live unread
notification count distinct. Do not force every source change to restart later pages.

The everyday advanced editor displays up to three group levels compactly. An expanded mode
supports the contract's eight-level bound with collapsible labelled groups; it cannot refuse a
valid saved expression simply because its compact editor is narrower. Offer an explicit group
negation control and spoken NOT label. Do not auto-distribute NOT across children's operators.

URL policy: use existing legacy query parameters where representable; otherwise a versioned
uier query encoding up to an agreed encoded size (initially 2 KiB). Larger Copy view link actions
create an explicit server-side scoped query reference with expiry. A link's scope is reauthorized
on every open. It cannot grant privileges or silently discard an unavailable field. Private draft
and shared view reads have their own ownership rules. Toolbar state never goes in host storage/URL.

## Async and rendering performance

- Use the TanStack Query version already declared on both surfaces. New query functions consume
  its AbortSignal, and the transport/extension adapter must propagate cancellation. A request
  generation guard also discards a late response. Source:
  [TanStack cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation).
- SSR and hydrate the first app page once. Do not use router refresh or a server action that
  rerenders the whole app shell per keystroke. Keep the query bar and composer mounted.
- Fetch rows first; counts only for visible tabs/columns; facets/options when their picker opens.
  Allow a short delayed spinner to avoid flashing on a fast request. Counts never borrow a stale
  zero or a total from a different scope. Cache exact counts only with their revision.
- Async options use server ranking/filtering. Disable the Combobox's competing local filter when
  the server already filtered a paged option set. Selected IDs are resolved/pinned separately,
  so scrolling/searching options never clears a selection. Show removed/unavailable values without
  disclosing an unauthorized person's identity.
- Start at 50 rows/maximum 100 per request. Add measured windowing for accumulated long lists or
  large option sets, not as a substitute for backend pagination. Retain the focused/open row and
  offer keyboard Load more; do not remove the active descendant from the DOM during navigation.
- Lazy-load advanced editor/calendar and any optional virtualizer/reordering code on first use.
  A query field catalog and common enums are small and local. Keep shared contract imports
  tree-shakeable and include bundle-size evidence in the toolbar acceptance gate.

## Accessibility and surface rules

Use short, sentence-case labels, Geist, existing semantic tokens/radii, status dots and priority
flags from [the brand](../../../packages/brand/BRAND.md). Neutral chips must not borrow the unread
accent. The toolbar and all its menus stay in InkScope, regardless of host theme.

App forms use FieldGroup/Field, FieldSet/FieldLegend and FieldError. Expose invalid state on
the field/control and give Dialog/Sheet a title. Use `render`, not `asChild`; preserve the local
overlay backdrop and focus fixes. Reuse app sonner only for appropriate operation failures.

Toolbar portals use `useInkContainer() ?? rootElement`; keep them inside the shadow/top-layer
context. Generalize the existing native-modal shell rather than importing a shadcn Sheet or
reusing composer-specific collapse behavior. Existing
[LocationPicker](../../../packages/toolbar/src/components/sidebar/LocationPicker.tsx),
[InkScope](../../../packages/toolbar/src/components/InkScope.tsx),
[ComposerModal](../../../packages/toolbar/src/components/ComposerModal.tsx) and
[focus helpers](../../../packages/toolbar/src/focusKeys.ts) show the required boundaries.

Tab reaches controls; arrows follow the actual menu/listbox composite; Space/Enter selects;
Escape goes back/closes the current editor and restores focus. Do not apply a menu's arrow
handler to a text field or another widget. All/Any/Not groups need spoken labels and indentation
that does not depend only on color. Sort reorder always has named keyboard buttons. Maintain
44 px touch targets, visible focus, stable focus after row removal and no focus moves when result
rows reorder. Do not add an unguarded global F shortcut to a reviewed page.

Translate field/operator labels, summaries, counts, error/empty text, date presets and announcements
in all six toolbar catalogs. Localized strings cannot become database field IDs or sort keys.
Update the app filter note and toolbar feature note when the implementation lands; keep proposed
behavior in this design folder until then.
