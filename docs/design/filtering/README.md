# Filtering and ordering in uier

Design research and proposed interaction contract, 11 November 2026 (Europe/Zagreb;
screenshots captured on 10 November UTC).
The UI guidance describes future implementation. The first Cosmos backend is described in the
[comment query area note](../../../apps/web/docs/comment-query.md); existing screens still use their current APIs.

The current backend recommendation and delivery sequence are in the
[Cosmos-first Azure plan and costs](azure-primitives-plan.md), with the
[component contracts](components-plan.md). The [PostgreSQL backend](backend-plan.md) and its
[delivery sequence](implementation-plan.md) are contingent alternatives only if measurement
justifies another database. These documents describe the complete query/performance contract.

Use **Linear's compact, editable filter chips for everyday triage**, **Notion's explicit
condition groups for complex queries**, and **an ordered list of sort rules on both surfaces**.
The app and toolbar should express the same query, with a layout suited to each surface.

The [reference gallery](references.md) contains screenshots, public examples and capture limitations.
The live [Notion Projects & Tasks example](https://notion.notion.site/Projects-Tasks-1ea72db0bc4f4c519e67ffed245560b2)
opens without an account. Linear's private workspace required browser sign-in; its screenshots
come from Linear's official documentation examples.

## What to take from the references

| Pattern | Evidence | Decision for uier |
| --- | --- | --- |
| A query stays legible after the menu closes | Linear shows property, operator and selected values in removable chips | Show the active conditions beside Filter. Let people edit their operator or value without rebuilding the query. |
| Simple filtering has a short path | Both products expose filtering beside the collection | Open a searchable property picker, then its values. Do not open the full condition editor for one priority or person. |
| Complex logic is explicit | Both document nested AND/OR groups | Add an Advanced filter editor with visible All/Any groups. Never imply OR through the placement of chips. |
| Filtering and presentation are different | Linear separates filters from Display options; Notion separates filter and sort controls | Keep Filter, Sort and List/Board distinct. A layout change preserves the query. |
| Sort priority is visible | Notion documents multiple sorts with precedence | Show numbered rules, each with a field and direction. The first rule wins; later rules break ties. |
| Personal exploration is distinct from a shared view | Both products document explicit ways to persist shared configuration | Applying a condition changes the viewer's query. Saving a shared view is a separate, permission-checked action. |

Sources: [Linear filters](https://linear.app/docs/filters),
[Linear display options](https://linear.app/docs/display-options),
[Linear custom views](https://linear.app/docs/custom-views),
[Notion views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts).
These are design deductions from those sources, rather than claims that their interfaces are identical.

## Starting point in this checkout

| Capability | App comments | Toolbar inbox |
| --- | --- | --- |
| Conditions today | Search, priority, environment, page/section, people shortcuts, unread, restricted author filter | Search, environment, page/section, unread, assigned to me |
| Logic today | AND between fields, one choice per field | AND between fields, one choice per field |
| Status today | Active and its three statuses, Done, All, Archive; board columns show workflow status | Equivalent scopes, with different internal names |
| Order today | List: priority, then newest comment number. Board: a shared choice per column; Done defaults to recent completion, Archive to recent archive time | Newest first, without an ordering control |
| Query persistence today | URL parameters; board sorting is saved on the project | Memory across SPA navigation; filter text is deliberately not saved to host-site storage |
| Default location | Whole project, all environments | Current page and environment |
| Result bounds today | Up to 1,000 ordinary and 1,000 archived threads before local presentation filters | Bounded lists of up to 200 threads; unread has a separate retrieval path |

Current contracts and source:
[app filters](../../../apps/web/docs/comment-filters.md),
[app inbox and board](../../../apps/web/docs/comments-inbox.md),
[app query](../../../apps/web/src/components/app/comments/commentsQuery.ts),
[author participation](../../../apps/web/src/lib/repo/authorFilter.ts),
[app evaluation](../../../apps/web/src/components/app/comments/ProjectComments.tsx),
[app result windows](../../../apps/web/src/lib/app/projectComments.ts),
[board settings](../../../apps/web/src/lib/app/boardSort.ts),
[sort comparators](../../../apps/web/src/components/app/comments/commentOrder.ts),
[toolbar evaluation](../../../packages/toolbar/src/components/sidebar/CommentsFilter.tsx),
[toolbar list assembly](../../../packages/toolbar/src/components/sidebar/useInboxComments.ts),
[toolbar persistence boundary](../../../packages/toolbar/src/openPanel.ts).
The current inbox note and source describe the board's collapsed Archive column; the older final
paragraph in the app filter note still describes Archive as list-only.

## The shared query model

Keep five concepts distinct: **project/access scope**, **location**, **conditions**, **ordering**
and **layout**. Switching layout must not change the other four. No query can widen access.

Use one typed condition model and one operator vocabulary across the app, toolbar and server.
Keep the visual components native to each surface. Translate existing URL parameters into this
model so old links continue to work.

### Everyday conditions

| Field | Controls and operators | Rules |
| --- | --- | --- |
| Status | Searchable multi-select; is any of / is none of | Open, In progress, Ready to verify, Done. Active is a shortcut for the first three, not another stored status. |
| Priority | Multi-select; is any of / is none of | Urgent, High, Normal, Low. Missing legacy priority means Normal. Keep the flag and its text. |
| Assignee | Multi-select people; includes any / includes all / includes none; is empty / is not empty | A thread can have several assignees. Keep Assigned to me and Unassigned as shortcuts. Resolve Me for the viewer, including when opening a saved view. |
| Opened by | Person picker, including Me; is any of / is none of | Match the thread's first-message author. Keep Opened by me available as today; named-person choices retain the restricted author-directory boundary. |
| Author participated | Restricted person picker; is any of / is none of | Preserve the existing `author=` filter: an opener or author of a remaining reply. Keep old author links mapped here, rather than changing them to opener-only queries. |
| Environment | Existing authorized location picker | Include meaningful missing/removed-source states when available. Keep the environment visible when choosing pages. |
| Page | This page, All pages, exact page, section | Use canonical page identity. A section includes its base and descendants; `/blog` must not match `/blogger`. Do not collapse repeated slashes. |
| Read state | Unread / Read | Unread is relative to the viewer. Opening an unread result must not immediately remove the thread being read. |
| Text | Search above the collection; optional contains / does not contain in advanced rules | Define the same searchable fields on both surfaces. Preserve literal, case-insensitive word matching; do not silently introduce regex or fuzzy semantics. |
| Created / Updated | On, before, after, between; relative presets | Include dates in the complete query contract. Define the timezone and calendar-day boundaries; show them in the editor. |

Do not add labels, cycles, due dates or other provider-specific fields just because a reference has them.
Only offer fields backed by uier data and authorized server queries.
Do not expose a people directory or option counts beyond the viewer's grants.

Within a single-value field, selected alternatives use OR: `Priority is High or Urgent`.
Between everyday conditions, use AND: `Priority is High or Urgent AND Assignee includes Me`.
Multi-assignee includes-all is explicitly different from includes-any. An empty selection removes
the condition; it must not mean an empty result set.

Keep Archive as a separate collection scope, visibly labelled. All continues to exclude archived
threads. Choosing an ordinary status from Archive returns to ordinary comments. Status tabs and
the condition editor are two controls for the same status expression: changing one replaces that
expression, rather than adding a second hidden status constraint. An advanced expression that
cannot map to a tab shows Custom; it must not leave Active looking selected.

### Advanced groups

Offer **Advanced filter** inside Filter. The editor starts with **Match all conditions** and
offers **Match any condition**. Each bordered group owns its connector; indent child groups
and repeat their All/Any label. Provide Add condition, Add group, and named removal controls.
Use three group levels, counting the root, in the compact editor. The complete contract adds
visible group negation and an expanded mode for up to eight levels; see the
[query bounds](backend-plan.md#versioned-query-contract). Never flatten or silently drop a deeper
valid expression when opening a saved view.

Example, inside the visible Production scope:

```text
Match all
  Status is any of Open, In progress
  Match any
    Priority is Urgent
    Match all
      Assignee includes Me
      Read state is Unread
```

This means `Production AND (Open OR In progress) AND (Urgent OR (Me AND Unread))`.
Do not flatten it into independent chips joined by an implied AND.
Summarize complex logic with a chip such as `Advanced filter · 4 conditions`, with a readable
summary in its editor. Count leaf conditions, excluding location and sorting, consistently.

Property and operator choices determine the value editor. Changing the property resets
incompatible operator/value choices. Incomplete rules stay as a draft and disable Apply, with
an inline explanation. Add/remove/group changes in the advanced editor apply together through
Apply; Cancel or Escape discards that draft. A completed simple condition applies immediately.
Multi-select values update in place without closing the picker after every choice.

## Filtering UI in the app

Keep the existing comments header structure:

1. Search at the start of the row; Filter with an active-condition count, Sort with its current
   summary, and List/Board at the end. On narrow widths, move active chips onto their own row.
2. Removable chips stay visible below or beside Search. Use `Priority is High or Urgent`,
   `Assignee includes Me`, and a location summary; truncate long values with the full accessible name.
3. Keep status scopes and the unread count where users already find them. A quick shortcut updates
   the same visible condition as the editor. Enabling Unread should not silently change page or status.
4. Filter opens a property search. Put Status, Priority, Assignee, Opened by, Location and Read state
   first; place Advanced filter after the common choices. Search may match property or value names,
   with the property shown beside every result so a person's name cannot be confused with text search.
5. The advanced editor has enough width for property, operator and value on one row. Stack a row's
   controls at phone widths, rather than making the dialog horizontally scroll.

Clear filters removes optional conditions and search, while retaining the visible location,
collection scope, order and layout. Reset view restores the surface defaults, including location
and order. Name both actions by their scope; never use an ambiguous Reset beside several controls.
For multi-project lists such as My work, retain project identity on rows and authorize every project.

## Filtering UI in the toolbar

Use the same fields, operators, condition summaries and ordering semantics that the viewer is
allowed to use in the app. Keep current page/environment as the initial scope. The toolbar is
an on-page inbox, so the full app header will not fit its 320–400 px panel.

- Keep Search on its own row. Put the location summary below it, with Filter and Sort controls.
  Use icon buttons with accessible names and tooltips where needed, including their active state.
- Wrap the everyday chips. For a larger query, show the first two and a `+N conditions` button
  that opens the full summary. Keep at least one visible indication while any condition is active.
- Replace the existing standalone assignment/unread controls with shortcuts to the same query
  model. If a shortcut intentionally widens to all pages, name that action explicitly, such as
  Unread across all pages; do not make scope expansion an invisible side effect.
- Use a panel-contained editor with back navigation between property and value pickers. On a
  phone, use the available sheet/dialog pattern with a scrollable body and reachable Apply/Cancel.
  Avoid nested flyouts that extend beyond the page edge or sit beneath a host-site modal.
- Keep active conditions when opening a thread, changing the dock side or following SPA navigation.
  This page is dynamic and follows the new canonical page; an explicitly selected page stays fixed.
- Do not put search text, people, condition JSON or filter state in the reviewed site's URL or
  local/session storage. Keep it in memory, or use authenticated uier-owned persistence for an
  explicit saved-view feature. The host origin is not a private uier settings store.

The toolbar list query controls the inbox, not a new promise that all pins on the host page are
filtered. Preserve current pin behavior until pin filtering is separately designed. Cross-page
results must continue to identify their source and offer the appropriate page action.

## Ordering on both surfaces

Use a separate **Sort** control. Show a short summary when active, for example `Priority ↓ +1`.
Opening it shows rules in precedence order, with field, direction, remove, Add sort, and Move up /
Move down actions. Dragging may be offered as an additional interaction. Prevent duplicate fields.

| Field | Direction labels | Meaning |
| --- | --- | --- |
| Priority | Urgent first / Low first | Use the explicit Urgent, High, Normal, Low rank. |
| Created | Newest first / Oldest first | Creation timestamp; missing dates sort last, then use subsequent rules and the ID tie-breaker. |
| Updated | Recently updated / Least recently updated | A saved change, including replies and workflow changes; legacy records fall back to creation time. Say so in supporting text. |
| Comment number | Highest first / Lowest first | Numeric comparison, not lexical ordering of `#100` and `#99`. |
| Completed | Recently completed / Earliest completed | Offered in Done; legacy records fall back to update time, then creation time, matching today's completion history. |
| Archived | Recently archived / Earliest archived | Offered in Archive only; missing archive times fall back to update time, then creation time. |

Sort the full matching set. Use subsequent rules only to break ties. After the visible rules,
append a stable, unique comment ID tie-breaker; keep missing timestamps last in either direction.
Show missing values as unknown, rather than pretending a missing date is today. A direction
button reverses one rule, not all rules.

Preserve initial defaults during migration: the app list remains priority then newest number,
and the toolbar remains newest first. Offer a shared preset such as Priority then newest in
both. When an explicit query is opened in the other surface, carry its order with it.

On the board, status columns retain their workflow order. A personal sort applies **within**
columns and uses the same query when switching to List. With no personal override, keep the
existing project column settings, including Done and Archive history ordering. Say `Project
column order` in the Sort summary in that state. A saved shared view must record this distinction.
Sorting does not introduce manual order: dragging between columns remains a status change;
dropping within a computed order cannot promise a persistent arbitrary position.

Existing project board sorts are shared and permission-checked. Do not overwrite them when
someone changes their personal Sort. Keep the project-wide column menu distinct, with copy
that states who will see the change, and retain optimistic rollback on failure.

## Saving and sharing

Keep exploration personal. Apply is not Save for everyone. The planned saved-view feature will
store the condition tree, location, order, layout, scope and version, with a name and owner.
Default new views to personal; sharing requires an explicit action and existing project grants.
Changing a shared view creates a personal override until an authorized user saves it.

Keep app queries shareable in uier URLs, with validation and backwards compatibility. Opening
a link never grants access. For the toolbar, Copy view link should produce a uier-owned link
that restores the query and then opens review, without writing private query text into the
reviewed site's address. Saved Me and Unread expressions remain relative to the person opening them.

## Visual and interaction rules

Follow [the brand](../../../packages/brand/BRAND.md): Geist, semantic tokens, sentence case,
outline icons, borders and the existing radius scale. Filters are neutral controls; blue
continues to identify unread, links and focus. Keep status dots and priority flags with text.
The toolbar inbox stays inside its ink theme, including its menus.

Use the existing app shadcn/Base UI controls (`render`, not `asChild`) and toolbar
`@signalco/ui`/primitives inside the shadow root. Reuse FilterChip, LocationFilter/LocationPicker,
Popover/Popper, checkbox, roving focus and announcement helpers. Share the query logic rather
than importing the app component bundle into the embeddable toolbar.

Every action must work with a keyboard: Enter/Space to open or choose, arrows inside the
appropriate composite, Escape to go back/close, focus returned to the opener. Give each clear
button a name such as `Priority is Urgent, clear filter`. Expose selection with checked/pressed
states. Provide keyboard sort reordering and 44 px touch targets. Do not add a global F shortcut
to the host page without the toolbar's existing shortcut guards and opt-out.

Keep controls mounted during loading, announce the result change politely, and avoid moving
focus when results reorder. Preserve the opened thread through ordinary presentation filters
only while it remains authorized, with an out-of-results indication when needed. Clear its
detail and cached sensitive content on account/project/access changes or when the new authorized
environment/author snapshot excludes it. Retain newer edits during ordinary realtime updates.
Use a visible loading state while fetching a new query; a delayed response
for an older query cannot replace the newer result.

Indexed Cosmos paging can remain live, with stable tie-breakers and explicit handling of moving
results. A complete residual evaluation can retain an ordered result session for later pages.
Ordinary updates offer Refresh results; privacy/redaction changes invalidate affected cached
data immediately. Do not describe either mode as an atomic historical database snapshot.
The [current paging contract](azure-primitives-plan.md#4-results-counts-and-paging) defines the
distinction; the PostgreSQL alternative's temporal protocol is not a baseline requirement.

For no matches, show the current conditions and Clear filters, with a separate way to broaden
location or status. Distinguish no matches, no comments, incomplete retrieval and a failed query.
Never render a failed or capped query as a conclusive empty project. Localize the toolbar's
controls, operators, summaries and announcements in its six existing catalogs.

Result counts follow the active location and query. Status-tab counts show what changing that
status would return, retaining the other conditions. Never combine a project-wide total with a
filtered result count under the same label. Omit an unavailable option count rather than display
a made-up zero; make a bounded or partial count explicit.

## Delivery gates

1. Define and validate the shared query schema, operator semantics and authorization first.
   Apply authorized filtering and ordering in storage **before pagination**. A new UI over the
   current 200/1,000-item windows cannot guarantee oldest-first or all matching comments.
   Cursor, cache keys, counts and realtime invalidation must include the normalized query.
2. Ship multi-value everyday conditions, named chips and explicit ordering on both surfaces.
   Keep existing default scopes, links, restricted author visibility and project board settings.
3. Add the All/Any editor on the same query representation, including bounded nesting, validation,
   empty-value semantics and draft recovery. Add named saved views after their ownership and
   persistence contract exists. AI query generation and new grouping layouts are separate work.

Acceptance should cover equivalent results in app/toolbar for the same authorized query;
multi-value OR and nested AND/OR; unassigned and missing values; unread while opening a thread;
Archive isolation; exact pages, sections and repeated slashes; stable ties and page cursors;
permission-restricted options/counts; personal versus shared sorting; browser Back/Forward;
older matching threads beyond today's caps; failed/late requests; and keyboard, touch, narrow
layouts, both app themes and the toolbar's ink theme. Optional future audit-derived conditions
must distinguish missing audits from passing audits.
