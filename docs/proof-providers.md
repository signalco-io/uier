# File proof providers

File formats are enabled per project in **Files → File formats**. Keep an
unqualified format paused. PNG, PDF, ordinary video and EML uploads work
with the app's proof storage. Figma imports use a member-supplied personal
access token with `file_content:read` and access to the selected Figma file.
The app has no shared Figma credential. See the [source and API contract](../apps/web/docs/proof-api.md).

## Isolated HTML host

Set `UIER_PROOF_HTML_ORIGIN_PREVIEW` and `UIER_PROOF_HTML_ORIGIN_PRODUCTION`
as repository variables for the credential-free build. Each is a separate
HTTPS origin on a dedicated domain outside `uier.io`, with a DNS record
pointing to the project's Vercel domain target. The build embeds the
corresponding origin in the viewer and the route guard. Configure an
exception for the isolated preview hostname if Vercel Deployment Protection
covers it. The signed proof URL supplies application authorization on that
host. Keep the ordinary preview application protected as configured. [Vercel Deployment Protection Exceptions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions)

1. Build and deploy the selected commit using existing CI after setting the origin variable.
2. Run **Configure file proof providers** on `main` with feature `html`, the target environment and the exact deployment URL. It needs the existing target environment's `VERCEL_TOKEN` with project alias access. The workflow checks the selected deployment and probes the isolated host's app root for a 404.
3. On the app origin, upload a prototype with `index.html`, local CSS, and local JavaScript. Open its iframe from a permissioned review. Verify the script and assets load only from the isolated hostname. Verify direct resource requests on the app host fail and revocation blocks another isolated load. Reattach the preview alias when changing the deployment being qualified.

For the production-build browser test on loopback, use separate hostnames for
the app and isolated renderer. The test app uses `127.0.0.1`. Use the same port
and renderer origin at build and test time. The exception for HTTP is local only.

```sh
NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN=http://localhost:4781 pnpm build
NEXT_PUBLIC_UIER_PROOF_HTML_ORIGIN=http://localhost:4781 PORT=4781 PLAYWRIGHT_FULL=1 \
  pnpm -C apps/web exec playwright test proof-imports.spec.ts --project="Desktop Chrome" --project="Mobile Chrome" --retries=0 -g "isolated prototype"
```

## Test email ingress

Choose a distinct literal mailbox for each environment, such as
`proofs@review.uier.io` and `proofs@review-preview.uier.io`. A separate
literal alias in an existing Cloudflare Email Routing domain also works.
Enable the mail hostname in Cloudflare and ensure the zone honors plus
addressing. Cloudflare matches the base alias and passes the full SMTP
recipient as `message.to`. Each review address adds a random 40-character
detail to the alias. The combined local part is at most 64 characters.
[Cloudflare subdomain setup](https://developers.cloudflare.com/email-service/configuration/subdomains/), [Cloudflare plus addressing](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)

Set the following values in the intended GitHub environment.

| Type | Setting | Purpose |
| --- | --- | --- |
| Variable | `UIER_PROOF_EMAIL_ALIAS` | Exact Cloudflare mailbox used for test review messages. |
| Variable | `UIER_PROOF_EMAIL_ZONE_ID` | Cloudflare zone whose Email Routing configuration serves the mailbox. |
| Variable | `UIER_PROOF_CLOUDFLARE_ACCOUNT_ID` | Cloudflare account that hosts the Worker. |
| Variable | `UIER_PROOF_APP_ORIGIN` | Stable HTTPS app origin for delivery to `/api/proof-mail`. |
| Secret | `UIER_PROOF_CLOUDFLARE_TOKEN` | Worker edit on this account, zone settings read and Email Routing rules edit on the selected zone. |
| Secret | `UIER_PROOF_EMAIL_SECRET` | Independent random relay bearer of at least 32 characters. Use a different value for each environment. |
| Secret | `UIER_PROOF_VERCEL_BYPASS` | Vercel automation bypass if the receiving app origin is protected. It stays in the Worker environment. |
| Secret | `VERCEL_TOKEN` | Existing environment's project token with permission to set app runtime variables. |

Run **Configure file proof providers** on `main` with feature `mail` and the
intended target. CI checks the zone's plus-addressing setting and the mail
hostname's MX, deploys the Worker, and creates and reads back the exact
literal rule if needed. A conflicting route stops the workflow. The route is
API-managed so the existing Pulumi adoption process can read it on the next
infra run. The workflow issues no catch-all, DNS or root alias writes.
Redeploy the app to pick up the new Vercel runtime variables.

On an email asset, create a test address and send v1 and v2 from a real mail
client. For one test, send a message whose SMTP envelope recipient is the
generated plus address and whose MIME `To` is a different address. Verify the
full recipient with its plus detail in Cloudflare's Email Routing activity
and the version in the intended asset. Retry the same Message-ID and content
and verify that the version count stays unchanged. Inspect sender, subject,
link destinations and inert previews. Rotate the address, verify the old
recipient is rejected and send a message to the new address. The Worker
forwards `message.to` without substituting MIME headers or the base alias.

## Video and PDF processing

The credential-free Vercel build and the manual notification worker package
install a checksum-pinned Linux FFmpeg binary. Local codec tests accept an
absolute `UIER_PROOF_FFMPEG_PATH`. Native MP4 or WebM previews can be remuxed
without it. Conversion-dependent uploads return an explicit unavailable
error when the processor is missing. Qualify actual browser playback and
seeking for MP4, MOV conversion and WebM at the target runtime.

PDF processing uses bundled PDF.js and local English OCR assets with no
external calls. In preview, open a restricted link for a fixture containing
metadata, hidden text and an attachment. Verify page search and check that
no private fixture marker appears in either guest artifact. Check that a
separate authorized original download matches the source bytes.
