import type { Metadata } from 'next';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { InlineLink, PageHeader, PageSection, Tile } from '../../../../src/components/marketing/ContentPage';
import { KnownPages } from '../../../../src/knownPages';

// Every control listed here is implemented and verifiable in this repository (apps/web/src/lib/comments,
// next.config.ts, infra/) or is a documented property of the service it names. Do not add a control
// before it ships, and remove one if it stops being true.

export const metadata: Metadata = {
    title: 'Security',
    description: `How ${brand.domain} protects the comments left on it, and how to report a vulnerability.`
};

const controls = [
    {
        title: 'Encrypted in transit',
        text: `${brand.domain} is served over HTTPS only, with HTTP Strict Transport Security, so browsers never fall back to plain HTTP.`
    },
    {
        title: 'Locked-down pages',
        text: 'A Content Security Policy limits where scripts and connections can go. Only the empty browser verification page can be framed. Browsers do not guess content types.'
    },
    {
        title: 'Anonymous identity',
        text: 'Your first comment sets a random 256-bit token in an HttpOnly, Secure, SameSite=Lax cookie. The server stores only its SHA-256 hash. Guest names are derived with a server-side key, so nobody can forge one.'
    },
    {
        title: 'Author-only actions',
        text: 'The server, not the toolbar, decides who may resolve, reopen or delete. Only the author of a comment or reply can, and deleting your comment never removes replies from other people.'
    },
    {
        title: 'Checked site origins',
        text: 'The showcase comments API accepts JSON writes only from its own origin. The project review API allows only the project’s configured site origins, identifies reviewers through headers and requires a signed browser verification proof for cross-origin writes.'
    },
    {
        title: 'Bot protection and rate limits',
        text: 'Writes require Vercel BotID verification. On reviewed sites, an empty frame on uier’s origin verifies the browser and returns a proof valid for five minutes, bound to the site, project and reviewer. New comments and replies have rate limits with atomic counters.'
    },
    {
        title: 'Strict input, plain output',
        text: 'Requests are validated against strict schemas and size limits (16 KB per request, 1000 characters per comment). Comments are shown as plain text: no HTML, Markdown or links.'
    },
    {
        title: 'An isolated toolbar',
        text: 'The toolbar renders in its own shadow root, so it neither changes nor inherits the page’s styles. A comment with bad data renders nothing instead of breaking the toolbar.'
    },
    {
        title: 'Minimal data, short retention',
        text: 'The API never returns author ids, IP data or device details beyond the device size. Comments are deleted automatically 90 days after their last change.'
    },
    {
        title: 'Encrypted at rest, in the EU',
        text: 'Comments are stored in Azure Cosmos DB in the West Europe region, which encrypts all data at rest. Preview deployments use a separate container and cannot reach production comments.'
    },
    {
        title: 'No secrets in code',
        text: 'Keys live in the hosting environment, set by the infrastructure code. CI signs in to Azure with short-lived OIDC tokens instead of stored credentials, and the resources that hold data are protected from deletion.'
    },
    {
        title: 'Reviewed changes',
        text: 'Every change to production goes through a pull request with passing checks. Infrastructure is applied only by CI, and dependencies are pinned and updated by Renovate one day after release at the earliest.'
    }
];

export default function SecurityPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Security"
                lead={`How ${brand.domain} protects the comments left on it, and how to report a problem. The code is open source, so you can check how it works.`}>
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={`mailto:${brand.contact.security}`}>Report a vulnerability</Button>
                    <Button variant="outlined" size="lg" href={brand.repository}>Read the code</Button>
                </div>
            </PageHeader>

            <PageSection
                id="report"
                title="Report a vulnerability"
                lead={<>Email <InlineLink href={`mailto:${brand.contact.security}`}>{brand.contact.security}</InlineLink>. Please do not open a public issue for a security problem.</>}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Tile title="What to send">
                        <p>What you found, the steps or a request that reproduces it, and the impact you expect. A page address or a comment id helps.</p>
                        <p>We will investigate every legitimate report and do our best to fix the problem quickly.</p>
                    </Tile>
                    <Tile title="While you test">
                        <p>Test with your own comments only. Do not read, change or delete other people&rsquo;s comments, do not overload the service, and do not post personal data.</p>
                        <p>In scope: {brand.domain}, its comments API, <code className="font-mono">/toolbar.js</code> and the code in the repository.</p>
                    </Tile>
                </div>
            </PageSection>

            <PageSection
                id="controls"
                title="How uier is protected"
                lead="The controls that are in place today.">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {controls.map(control => (
                        <Tile key={control.title} title={control.title}>
                            <p>{control.text}</p>
                        </Tile>
                    ))}
                </div>
            </PageSection>

            <PageSection
                id="data"
                title="Your data"
                lead={<>What is collected, who processes it and for how long is in the <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> and the <InlineLink href={KnownPages.LegalCookiePolicy}>cookie policy</InlineLink>. Comments on {brand.domain} are public, so never put secrets or personal information in them.</>} />
        </main>
    );
}
