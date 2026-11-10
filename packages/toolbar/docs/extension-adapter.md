# Packaged extension adapter

`src/extension.ts` configures `adapters.ts` before lazily importing `runtime.tsx`, the same mount
primitive used by the script entry. Configuration, transport, private images, draft storage, sign-out,
capture and the audit asset come from the trusted caller. Never read extension credentials from page globals.
`extensionContract.ts` is the v1 closed route/method contract for worker and backend. Keep it compatible
for one year after the last supported release. `coexistence.ts` is a secret-free DOM event handshake
so a mounted or late embed yields to extension activation across isolated worlds. DOM ids do not
prove ownership. `screenshotImage.tsx` uses byte-decoded canvas in extension mode for strict img-src.
The Chrome/Edge and Firefox apps use this adapter through the local
`@uier/extension-core` package. See [browser-extension.md](../../../docs/browser-extension.md) for
browser packaging, publication status and hosted gates.

Packaged request adapter failures must become CommentsApiError(network_error), preserving the
shared retry/draft recovery behavior. Keep HTTP status parsing outside that transport catch.

Reply images use the same brokered byte reads as original screenshots. The closed contract allows only
`GET comments/<id>/replies/<itemId>/screenshot`; the broker dispatches it to the shared authorized image
handler, while reply edits/deletes retain their existing methods. Uploads remain part of the reply POST.

## The audit asset

The Accessibility panel's audit and the on-demand page checks ([page checks](page-checks.md)) are the
audit asset, which packaged clients ship as a file of their own instead of loading `dist/audit.js`.

- `ToolbarAdapters.loadAudit` is optional. With it, `auditAvailable()` is true and `loadAudit()` in
  `checks/axeLoader.ts` calls it once (again after a failure); without it, a packaged client has no
  audit. Packaged clients never take the web path, a `<script>` element.
- The extension builds `checks/auditEntry.ts` as `audit.js` with an empty `__UIER_AUDIT_PATH__`, which
  selects the isolated-world handoff (`auditHandoff.ts`): the asset calls the callback at
  `Symbol.for('uier.toolbar.audit')` on its world's global object. The content script puts it there
  right before it asks the worker to run the file in its world, and removes it after. Never move the
  handoff to a script element, a DOM event or a main-world global: the page must not reach axe-core
  or the checks.
- `auditPrelude.ts` works on that world's own global there: the page's `axe` and `define` are not on
  it, and the `axe` that axe-core assigns is removed again.
