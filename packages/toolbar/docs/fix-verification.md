# Fix verification

`verification.ts` is the pure public display contract, status helper and literal description.
`CommentVerification` is shared by thread popovers and inbox cards, with signalco controls (its
Request verification form opens from Thread options or the status menu's Ready to verify, and Thread
options' button gets the focus back),
reviewer/admin permission flags and stable retry keys. Guest actor hashes never enter this model.
For a comment posted from a page check, its `evidence` (between the request and the answers) is that
check run again on the page ([a finding's check, run again](page-checks-verify.md)); it never decides.
The status badge reads `feedbackStage`'s label: In progress for a thread in progress and Ready
to verify for pending unresolved requests, its dot in the status's colour (Open an outlined ink ring, In progress
`--brand-in-progress`, Ready to verify `--brand-ready`, Done `--brand-success`, as the app's `StateDot`;
`data-status-dot`); the status menu's Done
says Done without verification there, and its Open and In progress cancel the check. Confirmation requires the server's current request revision.
Workflow mutations refresh all lists/activity, preserve failed details and never auto-acknowledge
activity. Ready remains in Open counts, with its own filter. The extension contract adds the
same narrowly allowed verification POST; retain all supported older routes.

The review project and comment DTOs include `verificationEnabled`. The setting is off unless explicitly enabled on the project. When off, status menus and the inbox Active filter omit Ready (including custom Ready entries), request/check controls are hidden, and a pending thread displays Open or In progress. A remembered Ready filter falls back to Active. Ordinary Done still closes that thread without confirmation. Re-enabling resumes requests that remain pending; no migration changes their stored evidence.

Locally pending comments copy `verificationEnabled` from the project viewer, keeping their workflow metadata aligned with the project before the create response arrives.
