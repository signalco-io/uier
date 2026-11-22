# Review sessions

Start a review from Options or from a new comment. The marker beside the pill shows the number
of unsent comments. The pill keeps its width. Choose the marker to inspect comments, enter a
title and summary, send the review or confirm discarding its unsent comments and replies.
An empty review offers **Close review** with a confirmation. Opening the panel focuses its
heading to keep the phone keyboard closed. A confirmation focuses its action, and Cancel returns
focus to its trigger. Unsent pins carry an amber dot on the round corner of the pin, and their
names include Not sent. Previously sent comments show the review number. The author can resume
the review from one of its threads. Focus then stays in the thread.

The project viewer response carries availability and the reviewer's current server-side draft.
The existing adaptive refresh keeps that response current. The marker fetches the pending
list through the authorized review detail route when opened. The toolbar adds the session and
draft IDs to new comments, including page feedback and quick comments from checks. Replies
stay attached to their existing threads. The extension broker allows only the named session
routes.

Browser-local text drafts retain their original submission key and session target after an
uncertain response. At capacity, the composer keeps the draft and disables **Add to session**.
The reviewer can explicitly post outside the session or send the review and start another with
the retained comment.

The behavior and delivery rules are in the [implementation plan](../../../docs/design/review-sessions.md).
