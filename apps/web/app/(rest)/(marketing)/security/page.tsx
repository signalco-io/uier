import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../src/components/marketing/ContentPage';
import { KnownPages } from '../../../../src/knownPages';
import { SecurityCover } from './SecurityCover';
import { MAX_BODY_BYTES, MAX_BULK_READ_BYTES, MAX_COMMENT_BODY_BYTES, MAX_NEW_COMMENT_BODY_BYTES, MAX_TEXT_LENGTH } from '@/src/lib/comments/limits';

// Every control listed here is implemented and verifiable in this repository (apps/web/src/lib/comments,
// next.config.ts, infra/) or is a documented property of the service it names. Do not add a control
// before it ships, and remove one if it stops being true.

export const metadata = publicPageMetadata('/security', {
    title: 'Security',
    description: `How ${brand.domain} protects the comments left on it, and how to report a vulnerability.`
});

const controls = [
    {
        title: 'Encrypted in transit',
        text: `${brand.domain} is served over HTTPS. After an HTTPS visit, HTTP Strict Transport Security tells browsers to use HTTPS for this domain and its subdomains for one year. The first visit still relies on reaching HTTPS.`
    },
    {
        title: 'Locked-down pages',
        text: 'App pages authorize fixed scripts by hash and streamed scripts with a fresh request nonce. Public pages keep an origin-based Content Security Policy that allows inline scripts. Only the exact browser verification and background sign-in paths allow framing by other sites; BotID resources allow same-origin framing. Unused browser capabilities are disabled, and browsers do not guess content types.'
    },
    {
        title: 'Anonymous identity',
        text: 'A guest identity uses a random 256-bit token. Starting a draft can keep it in local storage, and the toolbar sends it as X-Uier-Visitor. Posting or an explicit read action can set an HttpOnly, Secure, SameSite=Lax cookie, which takes precedence over the header. Opening a thread without an identity does not create one. The server stores a hash, and derives guest names with a server-side key.'
    },
    {
        title: 'Checked action permissions',
        text: 'The server checks access on every request. Project members can change a visible thread’s status; guests can change their own. Authors and workspace admins can edit or remove messages written in uier; imported messages are changed at their source. Removing an individual message can preserve other people’s replies; a separate authorized whole-thread deletion removes the discussion. uier staff moderate our feedback projects as admins.'
    },
    {
        title: 'Project sign-in and private feedback',
        text: 'A project review token is kept on the reviewed site, separate from the app’s HttpOnly session cookie. When the browser permits it, an empty uier frame can sign in an existing member after checking the exact site and current project access. Private project feedback is visible only to its author and workspace admins. Signed-in feedback on uier is private to its author and the uier team; guest showcase feedback is public.'
    },
    {
        title: 'Checked site origins',
        text: 'The showcase comments API accepts JSON writes only from its own origin. The project review API allows only the project’s configured site origins, identifies reviewers through headers and requires a signed browser verification proof for cross-origin writes.'
    },
    {
        title: 'Bot protection and rate limits',
        text: 'Browser writes require Vercel BotID verification. Coding tool writes require a revocable connection or access token limited to the projects and operations chosen for it, with current membership and private feedback checks on every request. On reviewed sites, an empty frame on uier’s origin verifies the browser and returns a proof valid for five minutes, bound to the site, project and reviewer. New comments and replies have rate limits with atomic counters.'
    },
    {
        title: 'Passkey sign-in',
        text: 'Passkeys need user verification on the device. Each challenge works once within five minutes, in the browser that asked for it. Adding a passkey needs a sign-in from the last 10 minutes. The private key never leaves the device or password manager; uier keeps the public key and rejects a signature counter that goes backwards. A removed passkey stops working at once.'
    },
    {
        title: 'Coding tool sign-in',
        text: 'Coding tools sign in through uier’s own OAuth server, for the MCP endpoint only. You choose which signed-in accounts to include and the workspaces and projects each can reach. Every project action checks one account’s current permissions. PKCE is required, codes work once within 60 seconds, access tokens last one hour and refresh tokens change on every use. Only token hashes are stored. Revoking a connection from its managing account ends its access on the next request.'
    },
    {
        title: 'Coding tool events',
        text: 'Event webhooks go only to public HTTPS addresses that first answered a signed challenge. The address is checked on every connection and redirects are not followed. Each delivery is signed with the secret the tool supplied, which uier stores encrypted, and with the server key that uier publishes. Access and visibility are checked again first. An open event stream checks access again every few seconds. A revoked connection receives nothing more.'
    },
    {
        title: 'Browser extension',
        text: `The desktop extension asks for temporary access to the tab you open it on, scripting, its own storage and sign-in. The only site it can reach on its own is ${brand.domain}; it cannot read cookies or history or change a site’s headers. Sign-in uses PKCE and a one-use handoff that expires within 60 seconds. Access tokens last 15 minutes, refresh tokens change on every use and only their hashes are stored. Credentials stay in extension storage the reviewed page cannot read, and every request rechecks membership and the site’s exact address.`
    },
    {
        title: 'Route-specific input limits',
        text: `Strict schemas validate every request. Ordinary JSON bodies allow ${MAX_BODY_BYTES.toLocaleString('en-US')} bytes, bulk read acknowledgements ${MAX_BULK_READ_BYTES.toLocaleString('en-US')} bytes, replies or replacements with an image ${MAX_COMMENT_BODY_BYTES.toLocaleString('en-US')} bytes, and new comments with an image and drawing ${MAX_NEW_COMMENT_BODY_BYTES.toLocaleString('en-US')} bytes. Message text is limited to ${MAX_TEXT_LENGTH.toLocaleString('en-US')} characters.`
    },
    {
        title: 'Safe message formatting',
        text: 'Messages support Markdown, including links and code. A shared parser renders supported formatting as React elements; it does not execute raw HTML or scripts. Link protocols are restricted, and Markdown images do not load remote files. Attached images are decoded and re-encoded before storage.'
    },
    {
        title: 'An isolated toolbar',
        text: 'The toolbar renders in its own shadow root, so it neither changes nor inherits the page’s styles. A comment with bad data renders nothing instead of breaking the toolbar.'
    },
    {
        title: 'Scoped data and retention',
        text: 'Public and guest views expose coarse device and viewport context. Authorized project members can see available browser and operating-system details to reproduce a report; unsupported details remain unknown. Feedback in uier’s own feedback projects expires 90 days after its last change; starter threads and their replies do not expire. Feedback in customer projects stays until deleted. Only a workspace admin can delete a project, after typing its name; failed cleanup is retried. Done and Archive do not erase feedback.'
    },
    {
        title: 'Encrypted at rest, in the EU',
        text: 'Comments are stored in Azure Cosmos DB in the West Europe region, which encrypts all data at rest. Preview deployments use a separate container and cannot reach production comments.'
    },
    {
        title: 'Continuous backups',
        text: 'Production data has continuous backup with a seven-day point-in-time restore window in West Europe.'
    },
    {
        title: 'No secrets in code',
        text: 'Keys live in the hosting environment, set by the infrastructure code. CI signs in to Azure with short-lived OIDC tokens instead of stored credentials. Deletion protection for data resources applies to Pulumi changes.'
    },
    {
        title: 'Separate deployment identities',
        text: 'Pull-request previews and production deployments use separate identities and scoped environment access. Production and preview database access uses scoped Entra identities; Cosmos account-key authentication is disabled. The scheduled notification worker has its own data access.'
    },
    {
        title: 'Checked changes',
        text: 'Production changes go through pull requests with passing checks. An approving review is not required. Selected type declarations and browser-test tools may merge automatically after three days. Other dependency and action updates wait for a maintainer to merge them. Infrastructure is applied only by CI.'
    }
];

export default function SecurityPage() {
    return (
        <main className="flex flex-col pb-16">
            <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-16">
                <PageHeader
                    title="Security"
                    lead={`How ${brand.domain} protects your comments, and how to report a problem.`}>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <Button variant="solid" size="lg" href={`mailto:${brand.contact.security}`}>Report a vulnerability</Button>
                        <Button variant="outlined" size="lg" href={brand.repository}>Read the code</Button>
                    </div>
                </PageHeader>
                <SecurityCover />
            </div>

            <PageSection
                id="report"
                title="Report a vulnerability"
                lead={<>Email <InlineLink href={`mailto:${brand.contact.security}`}>{brand.contact.security}</InlineLink>. Please do not open a public issue for a security problem.</>}>
                <Panel className="md:grid-cols-2">
                    <Tile title="What to send">
                        <p>What you found, the steps or a request that reproduces it, and the impact you expect. A page address or a comment id helps.</p>
                        <p>We will investigate every legitimate report and do our best to fix the problem quickly.</p>
                    </Tile>
                    <Tile title="While you test">
                        <p>Test with your own comments only. Do not read, change or delete other people&rsquo;s comments, do not overload the service, and do not post personal data.</p>
                        <p>In scope: {brand.domain}, its comments and project review APIs, the MCP connector and its OAuth sign-in, the published desktop extension and its API, the supported <code className="font-mono">/toolbar.js</code>, <code className="font-mono">/review.js</code> and <code className="font-mono">/audit.js</code> bundles, and the code in the repository.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection
                id="controls"
                title="How uier is protected"
                lead="The controls that are in place today.">
                <Panel className="md:grid-cols-2">
                    {controls.map(control => (
                        <Tile key={control.title} title={control.title}>
                            <p>{control.text}</p>
                        </Tile>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="data"
                title="Your data"
                lead={<>What is collected, who processes it and for how long is in the <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> and the <InlineLink href={KnownPages.LegalCookiePolicy}>cookie policy</InlineLink>. Guest feedback on our public pages is public. Check an image before posting; later redaction cannot recall copies already delivered.</>} />
        </main>
    );
}
