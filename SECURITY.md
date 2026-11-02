# Security policy

## Reporting a vulnerability

Email **security@signalco.io** (uier is a signalco project). Please do not open a public issue for a
security problem.

The machine-readable reporting contact is at
[uier.io/.well-known/security.txt](https://uier.io/.well-known/security.txt).

Send what you found, the steps or a request that reproduces it and the impact you expect. A page address or a
comment id helps. We will investigate every legitimate report and do our best to fix the problem quickly.

While you test, use your own comments only: do not read, change or delete other people's comments, do not
overload the service and do not post personal data.

## Scope

- [uier.io](https://uier.io), its comments API (`/api/comments`), authenticated MCP connector (`/api/mcp`) with its OAuth sign-in (`/api/oauth/*`, the `/.well-known/oauth-*` documents and the consent page under `/app/connect/`) and the toolbar bundle (`/toolbar.js`)
- the code in this repository

The controls that are in place are described on [uier.io/security](https://uier.io/security).

The unreleased browser extension uses separate revocable sessions, exact project/site bindings,
an isolated content script and a closed worker broker. An extension ID or CORS origin never grants
identity or bypasses browser verification. Production client registration is disabled by default.
See [the design and hosted release gate](docs/browser-extension.md).
