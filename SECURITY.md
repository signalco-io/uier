# Security policy

## Reporting a vulnerability

Email **security@uier.io** (uier is a signalco project). Please do not open a public issue for a
security problem.

The machine-readable reporting contact is at
[uier.io/.well-known/security.txt](https://uier.io/.well-known/security.txt).

Send what you found, the steps or a request that reproduces it and the impact you expect. A page address or a
comment id helps. We will investigate every legitimate report and do our best to fix the problem quickly.

While you test, use your own comments only: do not read, change or delete other people's comments, do not
overload the service and do not post personal data.

## Scope

- [uier.io](https://uier.io), its comments API (`/api/comments/*`), project review API (`/api/review/*`), authenticated MCP connector (`/api/mcp`) with its OAuth sign-in (`/api/oauth/*`, the `/.well-known/oauth-*` documents and the consent page under `/app/connect/`)
- the supported toolbar bundles (`/toolbar.js`, `/review.js`, `/audit.js`), published desktop extension and its session/site APIs (`/api/extension/*`)
- the code in this repository

The controls that are in place are described on [uier.io/security](https://uier.io/security).

The published desktop browser extension uses separate revocable sessions, exact project/site bindings,
an isolated content script and a closed worker broker. An extension ID or CORS origin never grants
identity or bypasses browser verification. Browser availability and release evidence are recorded in
[the extension guide](docs/browser-extension.md); reporting scope does not promise a release on every browser.
