# Privacy cleanup

`screenshotSchema` parses asynchronously and uses Sharp to decode/re-encode every incoming image,
with a 4096² pixel cap, first-frame-only output and no metadata. Stored output stays within 512 KiB
and 4096 px per side. All JSON route validation uses `safeParseAsync`.
`comments/cleanup.ts` is shared by whole-thread deletes and public screenshot replacement.
Authorized deletes persist an identifier-only cleanup intent before deleting the thread;
pending intents never expire, while completed intents expire after one day;
the scheduled notification worker retries related notification/read cleanup and legacy copies.
It also pages through screenshot metadata older than one hour, rechecks comment references and
uses image etags so a concurrent replacement survives the orphan sweep. `src/lib/screenshots/blobStore.ts`
stores raw bytes in private Azure Blob Storage; Cosmos stores only references on new writes. The
worker migrates 20 legacy images per environment per tick, preserving remaining TTL, and sweeps
Blob orphans in production and preview. See [screenshot storage](../../../docs/screenshot-storage.md).
Direct toolbar reads negotiate a 60-second read-only URL and download without uier headers; do
not redirect header-authenticated requests to Blob Storage. MCP/integrations read bytes server-side.
Related record TTLs use the thread’s remaining lifetime. Completed notification ledgers expire
after 30 days; the thread’s discovery floor prevents replay after ledger expiry. Blocked ledgers
are queried by failed/ambiguous status.
`copy-fonts.mjs` publishes the pinned Geist fonts and license before dev/build; static font files
are CORS-readable. `cspSources` allows the API origin for both `style-src` and `font-src`.
