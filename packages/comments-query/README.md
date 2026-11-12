# Comment queries

Pure query contract for uier app and toolbar backends. Import from `@uier/comments-query`.
The package contains no UI, storage, authorization or Node dependencies.

`parseQuery` validates untrusted version-1 documents and returns a canonical normalized document.
It rejects unknown properties, invalid field/operator/value combinations, invalid dates/timezones,
duplicate sorts and requests beyond the documented bounds. It throws `QueryValidationError` with
machine-readable `issues` paths. `serializeQuery` returns stable JSON suitable for a server hash.

`evaluateQuery(record, query, context)` evaluates collection/location/search/conditions against an
audience-safe `QueryRecord`. `evaluateExpression` evaluates only its tree. Context supplies the
current actor, page/environment and pinned evaluation time; it never supplies authorization.
`compareQueryRecords(a, b, order)` implements registered scalar orderings, missing last in either
direction, then stable scope/id ties. Priority and workflow status use their semantic ranks.

Fields use stable machine IDs. Enum selectors use `isAnyOf` and `isNoneOf`; relationship
sets use `includesAny`, `includesAll`, `includesNone`. Text supports `equals`,
`notEquals`, `contains`, `notContains`, `startsWith`, `endsWith`. Numbers support equality,
`lessThan`, `atMost`, `greaterThan`, `atLeast`, `between`. Booleans use `is`. Dates support
`before`, `after`, `on`, `between`; all applicable fields support `isEmpty`/`isNotEmpty`.
Page also supports `isPage` and `inSection`. Negation is an explicit `{ not: expression }` node.

Missing values match negative operators unless explicitly paired with `isNotEmpty`. An empty
relationship set is empty. Multi-value selections are nonempty in the wire contract; removing
the final selection removes the condition in the UI. Child groups cannot be empty; absent root
means true. Text comparisons are literal and case-insensitive. Enum/actor IDs and explicit
page selectors use exact case-sensitive identity. Quick search ANDs whitespace-
separated substrings; `contains` preserves the complete entered literal including spaces.

Me is `{ relative: 'me' }`. Date presets are `{ relative: 'today' | 'yesterday' | 'lastDays' |
'nextDays', days?: number }`; days is required for the latter two. Date-only values use the
query's IANA timezone. Calendar ranges use inclusive start/exclusive end and handle DST. Relative
days mean full calendar days: lastDays includes today; nextDays starts tomorrow. Date-time values
must include a timezone offset or Z. Dates are resolved against a pinned `evaluationTime`.

Bounds: 64 KiB serialized UTF-8; 100 leaves; eight group levels; 100 values/set; eight distinct
registered scalar sort keys; 1,000 quick-search characters and 50 search terms. These bounds
reject requests; they never truncate result sets or remove clauses.

The member-only `labels` set field uses stable label IDs with the standard set operators and
cannot be sorted. Server adapters resolve current definitions and enforce member capability
before evaluating it; the pure contract stores no label definitions or authorization.
