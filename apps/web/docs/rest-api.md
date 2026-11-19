# Public REST API

The [integration contract and quick start](../../../docs/api.md#public-rest-api-for-custom-integrations)
describe the supported operations. Each route under `app/api/v1/projects` calls a handler in
`src/lib/rest/api.ts`. Handlers authenticate the dedicated bearer, check its scope and budget,
then resolve the project and a fresh member actor. The review services own visibility, workflow
validation, reply attribution, rate limits and durable write receipts. The public response
projection includes text and workflow state. Account IDs, internal storage fields and attachments
are outside this contract. Feedback endpoints operate on website threads and apply the
token owner's current thread visibility. REST checks the requested thread before processing
a write receipt. Both public and private file threads use the
[proof-specific MCP handoff](mcp-connector.md#file-proof-handoff).

Feedback list and detail return the effective workflow `statusId` for every thread,
plus `archivedAt` (null for an unarchived thread) and an optional legacy archive destination
`archiveStatusId`. PATCH accepts `{ archived: true }` or `{ archived: false }` under
`feedback:status` with the usual idempotency key. Existing `{ statusId }` writes remain valid,
including legacy archive destination IDs.

Account → API tokens creates and revokes tokens. The shared credential store distinguishes REST
from MCP with a stored audience and a dedicated bearer prefix. Existing MCP tokens keep their
original audience. Project transfer and removal use the existing project-grant cleanup.

`contract.ts` holds the wire schemas. `openapi.ts` describes the operations and generates their
JSON shapes from those schemas. `/api/v1/openapi.json` is public. The standalone Scalar bundle is
copied from the pinned dependency during dev and build and loaded only at `/developers/api`.
The interactive client sends requests directly to the same origin with in-memory authentication.
When changing an operation, update its handler, schemas, OpenAPI description and REST API tests together.
