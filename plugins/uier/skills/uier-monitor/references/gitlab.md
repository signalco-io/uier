# GitLab operations

Read this for `repo.provider: "gitlab"`. The monitor's `pr`/`prs` fields and `mode: "pr"` also
cover merge requests. Store the project-local MR `iid`; links use the returned `web_url`.
Use authenticated `glab` on the recorded host, including GitLab Self-Managed. A missing CLI or
authentication is a setup blocker, not permission to switch to GitHub or close feedback.

## Detect the workflow

From `origin` and the repository notes, record `repo.provider`, `host`, `url`, `slug`, `root` and
`base` as described in [Starting the monitor](start.md#repository-workflow). The API project is
`projects/<URL-encoded full namespace/project path>`: encode every slash, including subgroups.
For example `team/subgroup/project` becomes `team%2Fsubgroup%2Fproject`.

Read with `glab api --hostname <host> <endpoint>`:

- `projects/<project>`: canonical `path_with_namespace`, `web_url`, `default_branch`, `merge_method`,
  `squash_option`, `only_allow_merge_if_pipeline_succeeds`, `only_allow_merge_if_all_discussions_are_resolved`,
  and `remove_source_branch_after_merge`.
- `projects/<project>/protected_branches` and the available approval rules: required merge permissions
  and approvals. A missing paid-tier endpoint does not prove that approvals are unnecessary; check
  the MR's `detailed_merge_status` and repository notes.
- `.gitlab-ci.yml`, its includes and the repository's deployment notes: the target branch,
  environment name, deployment jobs, rules, manual gates and retry policy.
- `projects/<project>/deployments?environment=<encoded environment>&order_by=id&sort=desc&per_page=30`:
  whether deployments record the intended environment and branch.

Use `workflow.mode: "pr"` unless the repository explicitly allows direct pushes. Preserve its
documented base. Record the allowed merge method and squash setting. `strict: true` applies when
the configured merge method requires rebasing onto the target (fast-forward or semi-linear).
Read actual merge-train settings rather than assuming GitHub's merge-queue semantics.
Set `harness.prWatch: false`: the helper polls GitLab even if an older state left this true.

Choose the deployment evidence explicitly:

- Prefer `deploy: { "kind": "deployments", "environment": "<exact name>", "branch": "<target>" }`.
  Only a successful deployment for that environment and branch which contains the merge closes items.
- Use `deploy: { "kind": "pipelines", "branch": "<target>" }` only when the repository confirms
  that a successful branch pipeline establishes deployment, including required downstream work.
  MR pipelines are excluded. Optional/manual deployment jobs or child pipelines that the parent
  does not wait for need environment records or another verified deployment gate.
- Use `deploy: { "kind": "none" }` only when merge is the intended completion gate. An unknown
  deployment setup stays pending clarification; never treat discovery failure as no deployment.

`requiredChecks` lists exact required job names; empty follows the whole head pipeline. Record
`pipelineRequired: false` only when project settings and repository notes permit merging without
a pipeline: an absent pipeline then passes only with GitLab's `mergeable` decision and no named
required jobs. Otherwise absent pipelines stay pending. The helper
fetches every page of jobs when names are configured. It keeps missing/manual/skipped checks pending,
and reports failed/canceled pipelines and jobs. It records merge, squash or fast-forward commits
and uses Git ancestry to recognize a later deployment containing the change.

## Review, merge and follow up

Use `glab mr view <iid> --repo <url> --output json` and `glab mr diff <iid> --repo <url>` for the
same review as GitHub. `projects/<project>/merge_requests/<iid>/diffs` (paginate) lists changed
files; check unexpected paths before deciding whether a review session is needed. Required
approvals and unresolved discussions remain merge gates. The helper wakes for those blockers,
requested changes, conflicts, failed CI, required rebases, closure or a ready MR without auto-merge.

Draft closing replies and add the pending deploy entry exactly as in the main skill. Then use
`glab mr merge <iid> --repo <url> --sha <reviewed-head> --auto-merge --yes`, adding `--squash` and
`--remove-source-branch` only as the repository allows. Confirm auto-merge from the MR response
before recording `prs.<iid>.autoMerge: true`; the command can also merge immediately. On older
GitLab versions use the supported merge-when-pipeline-succeeds operation if auto-merge is unavailable.
Never bypass a required pipeline, review, manual gate or merge train. A ready MR that cannot use
auto-merge can be merged after verifying the current head and all gates. A required human approval
waits for the person. The helper keeps following the MR; it needs no T3 PR watch.

A `need_rebase` status uses a rebase session on the monitor's branch. After another MR lands,
update only the monitor's branches that require rebasing; GitLab has no `gh pr update-branch`.
Confirm the reviewed head and auto-merge again after a push. A closed MR is a `pr-closed`/`pr`
event and must not be reported as merged.

For CI or deployment failures, read pipeline jobs with
`projects/<project>/pipelines/<id>/jobs?per_page=100` (paginate); save the failed job's
`projects/<project>/jobs/<job-id>/trace` to `STATE/logs/`. A deployment event's `run` is a deployment
ID: read `projects/<project>/deployments/<id>` to find `deployable.id` and its pipeline before
retrieving logs or retrying. A pipeline event's `run` is already a pipeline ID.
Retry an authorized transient failure once: `glab api --hostname <host> --method POST
projects/<project>/pipelines/<id>/retry` retries failed/canceled jobs; use the repository's full
pipeline rerun procedure when `workflow.rerun: "all"` requires it. Never automatically play manual jobs.
Record retries by run and attempt. If no deployment appears, inspect branch/job rules and report
the missing gate instead of treating a green MR pipeline as deployed.

Link MRs in uier with `link_feedback_pull_request` using their full canonical URL, as for GitHub.
Use T3 linking only where it supports the host; a harness limitation never replaces the uier link.
Closing replies label them `[MR !<iid>](<url>)`; `{commitUrl}` becomes `<repo.url>/-/commit/<sha>`.

Official references: [GitLab CLI API](https://docs.gitlab.com/cli/api/),
[merge requests](https://docs.gitlab.com/api/merge_requests/),
[pipelines](https://docs.gitlab.com/api/pipelines/),
[deployments](https://docs.gitlab.com/api/deployments/).
