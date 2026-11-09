# Packaged extension adapter

`src/extension.ts` configures `adapters.ts` before lazily importing `runtime.tsx`, the same mount
primitive used by the script entry. Configuration, transport, private images, draft storage, sign-out
and capture come from the trusted caller. Never read extension credentials from page globals.
`extensionContract.ts` is the v1 closed route/method contract for worker and backend. Keep it compatible
for one year after the last supported release. `coexistence.ts` is a secret-free DOM event handshake
so a mounted or late embed yields to extension activation across isolated worlds. DOM ids do not
prove ownership. `screenshotImage.tsx` uses byte-decoded canvas in extension mode for strict img-src.
See [browser-extension.md](../../../docs/browser-extension.md) for unreleased status and hosted gate.

Packaged request adapter failures must become CommentsApiError(network_error), preserving the
shared retry/draft recovery behavior. Keep HTTP status parsing outside that transport catch.

Reply images use the same brokered byte reads as original screenshots. The closed contract allows only
`GET comments/<id>/replies/<itemId>/screenshot`; the broker dispatches it to the shared authorized image
handler, while reply edits/deletes retain their existing methods. Uploads remain part of the reply POST.
