# Search discovery and acquisition

Public content lives under `apps/web/app/(rest)/(marketing)`. The homepage publishes connected
`WebSite` and publisher `Organization` JSON-LD from brand constants. The publisher is signalco;
there is no invented local business, rating, customer count or uier social profile. The guides at
`/guides/client-website-reviews` and `/guides/nextjs` describe shipped controls. The Next.js example
uses the same `nextJsSnippet` generator as a project's installation guide.

## Search consoles

Google Search Console's domain property uses the existing Cloudflare verification TXT record.
The homepage's `msvalidate.01` meta tag is the manual Bing Webmaster Tools proof for the uier
account. Preserve these proofs after verification. Both services should receive
`https://uier.io/sitemap.xml`. Submission and ownership verification do not guarantee indexing,
ranking or citation by an AI system. Bing's search and AI reports need real traffic and processing time.

## IndexNow after production deployment

`.github/scripts/search-index.mjs generate` runs after `next-sitemap`. It hashes public static
HTML's text, links, image descriptions, search metadata and JSON-LD into `/search-index.json`.
Framework scripts, CSS, class names and generated social-card query keys do not change a hash.
The dynamic status page stays in the sitemap but is omitted from notifications: health checks
are not editorial changes. Missing HTML for another sitemap entry fails the build.

The production build job captures the previously published manifest before building, in an
artifact containing public URLs and hashes only. After successful deployment, the IndexNow job
checks that the new manifest's revision matches the workflow commit, validates the public proof
file from `.github/indexnow.json`, then sends added, changed and removed URLs. Unchanged
deployments send nothing. The first deployment without a prior manifest submits all static public
pages once. Non-production deployments never submit. The random proof key is intentionally public.

The job runs without deployment credentials. It accepts only the exact HTTPS production host,
canonical public paths, bounded manifests and a verified public key. It refuses app, API,
notification, bridge and social-image paths, query strings and fragments. This is not a general
URL-submission endpoint.

HTTP 200 acknowledges submission; 202 means key validation is pending. Other responses fail the
notification job without rolling back the already deployed website. Inspect the failure and
rerun just the failed job while production still serves that workflow's commit. The baseline
artifact is retained for one day; for a later recovery, use a known previous manifest rather than
silently treating a failed fetch as an empty baseline. A superseding deployment must complete
its own comparison. Never bypass the revision check to submit from an obsolete run.

```bash
node --test .github/scripts/search-index.test.mjs
```

## Acquisition measurements

The Vercel team already has a Pro plan, which supports custom events with two properties.
Events use only `channel` and `source`; there is no Plus upgrade. Web Analytics must be enabled
for the project before the deployment. Pro analytics events are metered at $0.03 per 1,000,
subject to the team’s existing monthly usage credit; enabling it is not a free-plan assumption.
See [Vercel pricing](https://vercel.com/docs/analytics/limits-and-pricing). Events run only on the production `https://uier.io` origin;
previews and local checks do not emit them. Do Not Track and Global Privacy Control suppress
browser collection. Analytics page URLs drop query strings/fragments and collapse private app
paths to `/app`.

| Event | Meaning |
| --- | --- |
| `Acquisition visit` | A public document visit (client navigation within that document does not add another) |
| `Acquisition sign-in` | First successful sign-in for an account created after this rollout |
| `Acquisition first project` | First project successfully created by that new account |
| `Acquisition first review` | First new comment committed to a real project created by that account |

Filter Vercel Web Analytics custom events by `channel` and `source` to compare search, AI search,
social, referral, campaign and direct arrivals. Recognised sources include Google, Bing,
DuckDuckGo, ChatGPT, Copilot, Perplexity, Claude, GitHub, LinkedIn and X. Unknown sources are
coarsened to `other` or `unknown`. Non-organic UTM media are classified as campaigns. No arbitrary
UTM value, search term, referrer path, account identifier, project identifier or feedback is sent.

Arrival labels live only in a React context in memory. Public-to-app document navigation adds
`acq_channel` and `acq_source` enum hints to the app link (including its sign-in return path).
There is no new browser storage, cookie or visitor identifier. Direct app visits and sign-ins
that leave the document can have unknown source. The authenticated
`POST /api/acquisition` accepts only the two enum labels, requires the matching Origin and a
session, reads at most 256 bytes and can claim only that session's user. The new account's existing
Cosmos document holds first source, milestone times and delivered-stage names. Legacy users are
not backfilled. The data follows account erasure. The privacy policy discloses it.

Business services mark successful writes; the public showcase never counts as project activation.
ETag updates bound concurrent claims to one delivery per stage across tabs and devices. The app
claims pending events on navigation or window focus, then emits them through the browser SDK.
There is no extra polling loop or server analytics SDK forwarding private API URLs and headers.
Event properties are source and channel only. Milestone timestamps stay in the account record. Milestone records cost a user
point read and, on the first occurrence, a conditional write; claiming events also uses conditional
user-document updates.

These counts are a best effort acquisition cohort, not billing or an exact person-level funnel.
Blocked scripts, closed tabs and lost responses can lose an event; claims
are at most once. A first review can appear when the owner next focuses the app. The analytics event date is delivery time, rather than the milestone time; account records
retain the actual first-milestone timestamps. An OAuth round trip, full reload or sign-in opened in another browser
tab may lose the arrival source. Source claims arriving after the first 24 account hours become
unknown. Other team members' projects do not count as the owner's first project. Source labels
are visitor-reported context, never an authorization signal.

Focused checks are `acquisition.api.spec.ts`, `guides.spec.ts`, `seo.api.spec.ts` and the existing
onboarding/install journey in `app.spec.ts`. Production verification should inspect public HTML,
manifest/proof, console sitemap status and deployment logs. Do not create fake production
conversion events to populate reports; real traffic will fill the new event views.
