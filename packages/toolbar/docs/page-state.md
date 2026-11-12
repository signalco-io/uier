# Page identity

Which page a comment belongs to: `pageState.ts`, shared by the browser and the server and exported as
`@uier/toolbar/page-state`, and `hooks/usePagePath.tsx`. The project's page-state policy and its limits are in
[the API guide](../../../docs/api.md#comments-api) ("Meaningful page state").

- The canonical identity: the pathname by default, plus approved query fields and optional hash routes.
- `sourcePagePath` / `storedSourcePath`: the same filtering with trailing slashes kept, for links only, never a
  key.
- New project comments send the names of the page's other selectable query fields, for the settings'
  suggestions (`pageQueryKeys`).
- `usePagePath` follows SPA history and hash changes, with cleanup and a fallback.
