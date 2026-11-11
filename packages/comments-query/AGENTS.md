# comments-query

Pure, browser-safe query contracts. No React, DOM access, credentials, storage, SQL, localized
labels, or toolbar bootstrap imports. Keep field/operator validation and evaluator semantics
aligned; adapters must only push down predicates that preserve the complete candidate set.

`src/index.ts` exports the versioned document, registry, parser, normalization, evaluator,
date resolution and comparator. Tests live in `apps/web/e2e/comment-query-contract.api.spec.ts`.
Update README when the wire contract or operator semantics change. No authorization is performed
here: every server adapter must constrain scope and visibility independently of the user tree.
