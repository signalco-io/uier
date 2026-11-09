# Priority and matching

`triage.ts` exports pure priority values/defaults and `matchesFeedbackSearch` for app/toolbar use.
Missing priority means Normal, including pinned responses. The thread header shows a priority other
than Normal to everyone; Thread options changes it only with `permissions.priority`, and a failed
intended value retains the submission key. The review API rechecks membership/private visibility and current public-project
staff policy. The control is shared by thread and inbox, with cache/activity invalidation through
`useComments`. No toolbar bulk operations. Feedback packets include priority as additive context.
