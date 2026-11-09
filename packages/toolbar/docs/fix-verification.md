# Fix verification

`verification.ts` is the pure public display contract, status helper and literal description.
`CommentVerification` is shared by thread popovers and inbox cards, with signalco controls (its
Request verification form opens from Thread options or the status menu's Ready to verify, and Thread
options' button gets the focus back),
reviewer/admin permission flags and stable retry keys. Guest actor hashes never enter this model.
The status badge reads `feedbackStage`'s label: In progress for a thread in progress and Ready
to verify for pending unresolved requests, its dot in the status's colour (Open an outlined ink ring, In progress
`--brand-in-progress`, Ready to verify `--brand-ready`, Done `--brand-success`, as the app's `StateDot`;
`data-status-dot`); the status menu's Done
says Done without verification there, and its Open and In progress cancel the check. Confirmation requires the server's current request revision.
Workflow mutations refresh all lists/activity, preserve failed details and never auto-acknowledge
activity. Ready remains in Open counts, with its own filter. The extension contract adds the
same narrowly allowed verification POST; retain all supported older routes.
