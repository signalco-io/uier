# Fix verification

`verification.ts` is the pure public display contract, status helper and literal description.
`CommentVerification` is shared by thread popovers and inbox cards, with signalco controls (its
Request verification form opens from Thread options, whose button gets the focus back),
reviewer/admin permission flags and stable retry keys. Guest actor hashes never enter this model.
The status badge reads `feedbackStage`'s label: In progress for a thread in progress and Ready
to verify for pending unresolved requests; the ordinary action
says Done without verification. Confirmation requires the server's current request revision.
Workflow mutations refresh all lists/activity, preserve failed details and never auto-acknowledge
activity. Ready remains in Open counts, with its own filter. The extension contract adds the
same narrowly allowed verification POST; retain all supported older routes.
