# Search discovery and analytics status

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

## Analytics status

The owner chose to keep analytics collection disabled on 3 November 2026. Vercel Web Analytics
is disabled for this project, and `ClientProvider` does not inject the analytics SDK. This release
adds no acquisition events, source tracking, milestone records, cookies or browser storage.

A future analytics setup needs a deliberate provider/cost decision and matching privacy disclosure.
The existing Vercel Pro plan supports custom events with two properties; Pro Web Analytics is
metered at $0.03 per 1,000 events, subject to the team's existing usage credit. No Plus add-on
was enabled. See [Vercel pricing](https://vercel.com/docs/analytics/limits-and-pricing).

Focused checks are `guides.spec.ts`, `seo.api.spec.ts`, `social-cards.api.spec.ts` and the existing
onboarding/install journey in `app.spec.ts`. Production verification inspects public HTML,
manifest/proof, console sitemap status and deployment logs.
