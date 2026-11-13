import { ArrowRight, Check, CircleHelp, CircleMinus, Info } from 'lucide-react';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { InlineLink, PageHeader, PageSection, Panel, Tile } from '../ContentPage';
import { WorkflowPicture } from './WorkflowPicture';
import { checkedOn, checkedOnLabel, competitors, competitorSlugs, dimensions, uier, type CompetitorSlug, type Fact, type Product, type Support } from './content';

const statusIcons = { yes: Check, limited: Info, no: CircleMinus, unknown: CircleHelp };
const statusLabels: Record<Support, string> = { yes: 'Available', limited: 'Has limits', no: 'Not supported', unknown: 'Not verified' };
const choiceTitles: Record<CompetitorSlug, string> = {
    bugherd: 'Choose BugHerd for custom task workflows',
    'marker-io': 'Choose Marker.io for bug reproduction',
    usersnap: 'Choose Usersnap for product research',
    pastel: 'Choose Pastel for asset approval'
};

function SupportIcon({ support }: { support: Support }) {
    const Icon = statusIcons[support];
    return <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="mt-0.5 shrink-0" />;
}

function FactCell({ fact, product, dimension, compact }: { fact: Fact; product: string; dimension: string; compact?: boolean }) {
    const detail = <>
        <p className="text-xs leading-relaxed text-muted-foreground">{fact.detail}</p>
        {fact.source && <a href={fact.source} aria-label={`${product}: source for ${dimension.toLowerCase()}`} className="inline-flex min-h-8 items-center text-xs font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">Source</a>}
    </>;
    return <td className="p-4 align-top">
        <div className="flex items-start gap-2"><SupportIcon support={fact.support} /><span className="text-sm font-medium"><span className="sr-only">{statusLabels[fact.support]}: </span>{fact.label}</span></div>
        {compact ? <details className="mt-2 text-xs"><summary className="cursor-pointer py-1 text-muted-foreground">Details</summary><div className="mt-2">{detail}</div></details> : <div className="mt-2 pl-6">{detail}</div>}
    </td>;
}

function FeatureMatrix({ products, compact = false }: { products: Product[]; compact?: boolean }) {
    return <div className="flex min-w-0 flex-col gap-4">
        <ul aria-label="Comparison key" className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
            {(Object.keys(statusLabels) as Support[]).map(support => <li key={support} className="flex items-start gap-1.5"><SupportIcon support={support} />{statusLabels[support]}</li>)}
        </ul>
        <p id="matrix-help" className="text-sm text-muted-foreground">{compact ? 'Scroll across for every tool. Open Details for caveats and the source behind each entry.' : 'Scroll across on a narrow screen. Each entry includes its scope and, where applicable, a source.'} Not verified means unknown, not unsupported.</p>
        <div role="region" aria-label="Feature comparison table" aria-describedby="matrix-help" tabIndex={0} className="overflow-x-auto rounded-2xl border focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <table className={`w-full border-collapse text-left ${compact ? 'min-w-[1120px]' : 'min-w-[600px]'}`}>
                <caption className="sr-only">Website feedback capabilities compared: {products.map(product => product.name).join(', ')}</caption>
                <thead className="bg-muted/50"><tr>
                    <th scope="col" className="w-44 p-4 text-sm font-medium">Workflow or feature</th>
                    {products.map(product => <th key={product.name} scope="col" className="p-4 text-base font-semibold">{product.name}</th>)}
                </tr></thead>
                <tbody>{dimensions.map(dimension => <tr key={dimension.id} className="border-t">
                    <th scope="row" className="p-4 align-top text-sm font-medium">{dimension.name}</th>
                    {products.map(product => <FactCell key={product.name} fact={product.facts[dimension.id]} product={product.name} dimension={dimension.name} compact={compact} />)}
                </tr>)}</tbody>
            </table>
        </div>
    </div>;
}

function MethodNote() {
    return <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">Written by uier. Vendor documentation checked <time dateTime={checkedOn}>{checkedOnLabel}</time>. This is a comparison of documented capabilities, not a hands-on benchmark. Features and plan entitlements can change; the source links let you check them.</p>;
}

function ProductChoice({ product, title }: { product: Product; title: string }) {
    return <div className="flex min-w-0 flex-col">
        <WorkflowPicture kind={product.kind} />
        <div className="flex flex-col gap-3 p-6">
            <span className="text-xs font-medium text-muted-foreground">{product.focus}</span>
            <h3 className="text-xl font-semibold tracking-tight">{title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{product.bestFor}</p>
        </div>
    </div>;
}

function ProductPracticalities({ product }: { product: Product }) {
    return <div className="flex min-w-0 flex-col gap-4 p-6">
        <h3 className="text-xl font-semibold tracking-tight">{product.name}</h3>
        <dl className="flex flex-col gap-5 text-sm leading-relaxed">
            <div><dt className="font-medium">Setup and reviewers</dt><dd className="mt-1 text-muted-foreground">{product.setup}</dd></div>
            <div><dt className="font-medium">Integrations</dt><dd className="mt-1 text-muted-foreground">{product.integrations} <InlineLink href={product.integrationUrl}>Integration details</InlineLink></dd></div>
            <div><dt className="font-medium">Pricing model</dt><dd className="mt-1 text-muted-foreground">{product.pricing} <InlineLink href={product.pricingUrl}>Current pricing</InlineLink></dd></div>
        </dl>
    </div>;
}

function Sources({ products }: { products: Product[] }) {
    return <Panel className={products.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'}>
        {products.map(product => <div key={product.name} className="p-6">
            <h3 className="text-base font-semibold">{product.name}</h3>
            <ul className="mt-3 flex flex-col gap-3 text-sm">{product.sources.map(source => <li key={source.url}><InlineLink href={source.url}>{source.label}</InlineLink></li>)}</ul>
        </div>)}
    </Panel>;
}

function RelatedComparisons({ except }: { except?: CompetitorSlug }) {
    return <Panel className="sm:grid-cols-2">
        {competitorSlugs.filter(slug => slug !== except).map(slug => <div key={slug} className="flex flex-col gap-2 p-6">
            <h3 className="text-base font-semibold"><InlineLink href={KnownPageLinks.comparison(slug)}>uier vs {competitors[slug].name}</InlineLink></h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{competitors[slug].bestFor}</p>
        </div>)}
        {except && <div className="flex flex-col gap-2 p-6"><h3 className="text-base font-semibold"><InlineLink href={KnownPageLinks.comparison('website-feedback-tools')}>Compare all five tools</InlineLink></h3><p className="text-sm leading-relaxed text-muted-foreground">See capture, proofing, workflow and research capabilities in one matrix.</p></div>}
    </Panel>;
}

const tradeoffs: Record<CompetitorSlug, { keep: string; lose: string; test: string }> = {
    bugherd: {
        keep: 'Use BugHerd if your team depends on audio explanations, Figma or file review, due dates or custom Kanban columns.',
        lose: 'In uier, you would use live-page comments, short screen recordings and a fixed four-status workflow. File proofing, due dates and custom columns do not carry over.',
        test: 'Try one client review from first comment to reviewer confirmation. Check that uier’s five integrations cover the destinations you need; it does not provide BugHerd’s full integration catalog.'
    },
    'marker-io': {
        keep: 'Use Marker.io if replay, console/network evidence and scheduled monitoring are requirements.',
        lose: 'uier supports screenshots, short screen recordings and browser context. Replay, console logs and network requests are unavailable. Its page checks run during review rather than through a scheduled site crawler.',
        test: 'Report a real bug with the same browser and site login. Try a written reproduction and recording before replacing your existing diagnostics workflow.'
    },
    usersnap: {
        keep: 'Use Usersnap if your program needs satisfaction surveys, targeted feedback collection, public voting or product opportunities.',
        lose: 'uier covers on-page review, short screen recordings and resolving the resulting threads. It has no survey builder, public request board, opportunity model or native mobile SDK.',
        test: 'Separate website review from product research. Try uier for the review portion while retaining the surveys, voting or mobile collection tools your team still needs.'
    },
    pastel: {
        keep: 'Use Pastel if a review spans PDFs, images, videos and emails, or if approval must apply to an entire asset version.',
        lose: 'uier has no multi-format review canvas or asset-version approvals. A named reviewer can confirm one thread’s fix, which does not sign off the page, asset or release.',
        test: 'Try the same live website through your preferred uier installation route. Test authenticated pages. Keep asset proofing in a tool that supports those formats.'
    }
};

export function PairComparisonPage({ slug }: { slug: CompetitorSlug }) {
    const competitor = competitors[slug];
    const tradeoff = tradeoffs[slug];
    return <main className="flex min-w-0 flex-col pb-16">
        <PageHeader title={`uier vs ${competitor.name}`} lead={`An honest look at uier as a ${competitor.name} alternative: what overlaps, where the workflows differ and what you would give up.`}>
            <div className="flex flex-wrap gap-2.5"><Button variant="solid" size="lg" href="#choose">Which fits your work?</Button><Button variant="outlined" size="lg" href="#features">Compare features</Button></div>
            <MethodNote />
        </PageHeader>

        <PageSection id="choose" title="Choose by the work you need to finish" lead="Both tools collect visual feedback. The difference is what you need around that feedback." wide>
            <Panel className="md:grid-cols-2"><ProductChoice product={uier} title="Choose uier for live-page review" /><ProductChoice product={competitor} title={choiceTitles[slug]} /></Panel>
            <p className="text-xs text-muted-foreground">Conceptual workflow illustrations, not product screenshots. No scores or rankings.</p>
        </PageSection>

        <PageSection id="features" title="The feature comparison" lead="A check is a documented capability. The scope beside it matters just as much." wide>
            <FeatureMatrix products={[uier, competitor]} />
        </PageSection>

        <PageSection id="tradeoffs" title="What changes if you switch" lead="Check the workflows you rely on before switching.">
            <Panel><Tile title={`Reasons to keep ${competitor.name}`}><p>{tradeoff.keep}</p></Tile><Tile title="What uier does not replace"><p>{tradeoff.lose}</p></Tile><Tile title="What to try before deciding"><p>{tradeoff.test}</p></Tile></Panel>
            <p className="text-sm leading-relaxed text-muted-foreground">There is no built-in importer for {competitor.name}. Keep access to existing feedback and attachments; this comparison does not promise a migration of history.</p>
        </PageSection>

        <PageSection id="practicalities" title="Setup, integrations and cost" lead="Check the reviewer’s experience and the destination for feedback before choosing." wide>
            <Panel className="md:grid-cols-2"><ProductPracticalities product={uier} /><ProductPracticalities product={competitor} /></Panel>
            <p className="text-sm text-muted-foreground">For uier’s hosted service and open-source code, see <InlineLink href={KnownPages.Security}>security</InlineLink>, <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy</InlineLink> and <InlineLink href={KnownPages.OpenSource}>open source</InlineLink>. Review each vendor’s own policies for its data handling and service terms.</p>
        </PageSection>

        <PageSection id="sources" title="Sources and scope" lead="uier’s side comes from the shipped product and its source. Competitor entries come from the official pages linked here." wide>
            <Sources products={[uier, competitor]} /><MethodNote />
        </PageSection>

        <PageSection id="next" title="Try the review workflow" lead="If live-page review is the part you need, try it with one page and one reviewer.">
            <div className="flex flex-wrap gap-2.5"><Button variant="solid" href={KnownPages.App}>Create a project</Button><Button variant="outlined" href={KnownPages.ClientReviewGuide}>Client review guide</Button></div>
            <p className="text-sm leading-relaxed text-muted-foreground">See <InlineLink href={KnownPages.FixVerification}>fix verification</InlineLink>, <InlineLink href={KnownPages.PageChecks}>page checks and their limits</InlineLink> or <InlineLink href={KnownPages.Ai}>the MCP workflow</InlineLink>.</p>
        </PageSection>

        <PageSection id="related" title="Other alternatives" lead={<InlineLink href={KnownPages.Compare}>Back to the comparison guide</InlineLink>} wide><RelatedComparisons except={slug} /></PageSection>
    </main>;
}

export function AllToolsPage() {
    const products: Product[] = [uier, ...competitorSlugs.map(slug => competitors[slug])];
    return <main className="flex min-w-0 flex-col pb-16">
        <PageHeader title="Website feedback tools compared" lead="Five tools for overlapping jobs: live-page review, bug reproduction, product research and asset approval. Choose the workflow first.">
            <div className="flex flex-wrap gap-2.5"><Button variant="solid" size="lg" href="#features">Open the feature matrix</Button><Button variant="outlined" size="lg" href={KnownPages.Compare}>Comparison guide</Button></div><MethodNote />
        </PageHeader>

        <PageSection id="workflows" title="Different tools, different finish lines" lead="These pictures show the job each tool can help with. They are not replicas of the products." wide>
            <Panel className="md:grid-cols-2 lg:grid-cols-3">{products.map(product => <ProductChoice key={product.name} product={product} title={product.name} />)}</Panel>
        </PageSection>

        <PageSection id="features" title="Compare the actual capabilities" lead="No overall winner. Unsupported and unverified capabilities stay visible alongside supported ones." wide><FeatureMatrix products={products} compact /></PageSection>

        <PageSection id="gaps" title="When uier will not cover the job" lead="Use another tool, or keep it alongside uier, when these are requirements.">
            <Panel><Tile title="Reproduce a sequence"><p>uier supports short screen recordings with explicit permission. Built-in capture has no audio and ends on full-page navigation. Session replay, console logs and network capture are unavailable. Marker.io documents replay and diagnostics; BugHerd and Usersnap document recording. Their capture modes are different.</p></Tile><Tile title="Approve assets"><p>uier does not proof PDFs, design files, video or email. Pastel supports multi-format canvases and version approvals. BugHerd also lists file and Figma review.</p></Tile><Tile title="Run product research"><p>uier has no satisfaction surveys, public voting or roadmap. Usersnap combines these with visual feedback.</p></Tile><Tile title="Customize every stage"><p>uier’s statuses are Open, In progress, Ready to verify and Done. There are no custom statuses or release-wide sign-offs. BugHerd supports customizable board columns.</p></Tile></Panel>
        </PageSection>

        <PageSection id="setup" title="The practical differences" lead="Plan limits, reviewer access and integration behavior can change the decision." wide><Panel className="md:grid-cols-2">{products.map(product => <ProductPracticalities key={product.name} product={product} />)}</Panel></PageSection>

        <PageSection id="sources" title="Sources and scope" lead="Unknown is not a missing feature. We do not mark a competitor unsupported just because a page did not mention a capability." wide><Sources products={products} /><MethodNote /></PageSection>

        <PageSection id="related" title="Go deeper on one alternative" lead="Each comparison includes the tradeoffs and a practical check before switching." wide><RelatedComparisons /></PageSection>
    </main>;
}

export function ComparisonHub() {
    return <main className="flex min-w-0 flex-col pb-16">
        <PageHeader title="Find the right website feedback tool" lead="Compare uier with BugHerd, Marker.io, Usersnap and Pastel by the work you need to finish, including where another tool fits better.">
            <div className="flex flex-wrap gap-2.5"><Button variant="solid" size="lg" href={KnownPageLinks.comparison('website-feedback-tools')}>Compare all five tools</Button><Button variant="outlined" size="lg" href="#alternatives">Explore alternatives</Button></div><MethodNote />
        </PageHeader>

        <PageSection id="start" title="Start with the job" lead="A screenshot, a replay and an approval answer different questions." wide>
            <Panel className="md:grid-cols-3">
                <div><WorkflowPicture kind="review" /><div className="flex flex-col gap-3 p-6"><h3 className="text-xl font-semibold tracking-tight">Review a live website</h3><p className="text-sm leading-relaxed text-muted-foreground">Point at copy or layout, discuss the change and check the fix. Compare uier’s review workflow with BugHerd and Pastel.</p><InlineLink href={KnownPageLinks.comparison('bugherd')}>Compare website review <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" className="inline" /></InlineLink></div></div>
                <div><WorkflowPicture kind="diagnostics" /><div className="flex flex-col gap-3 p-6"><h3 className="text-xl font-semibold tracking-tight">Reproduce a bug</h3><p className="text-sm leading-relaxed text-muted-foreground">Capture what happened, not only how the page looked. Marker.io and Usersnap offer capture capabilities uier does not.</p><InlineLink href={KnownPageLinks.comparison('marker-io')}>Compare bug evidence <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" className="inline" /></InlineLink></div></div>
                <div><WorkflowPicture kind="proofing" /><div className="flex flex-col gap-3 p-6"><h3 className="text-xl font-semibold tracking-tight">Approve more than a page</h3><p className="text-sm leading-relaxed text-muted-foreground">Review a PDF, image, email or video and approve a version. Pastel supports a broader set of assets than uier.</p><InlineLink href={KnownPageLinks.comparison('pastel')}>Compare asset review <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" className="inline" /></InlineLink></div></div>
            </Panel>
        </PageSection>

        <PageSection id="alternatives" title="Compare one alternative" lead="Read the overlap, the missing capabilities and the practical differences side by side." wide><RelatedComparisons /></PageSection>

        <PageSection id="limits" title="Where uier fits" lead="Live-page comments, assignment and human fix verification.">
            <Panel><Tile title="See the review workflow"><p>Start with the <InlineLink href={KnownPages.ClientReviewGuide}>client review guide</InlineLink>, <InlineLink href={KnownPages.FeedbackTriage}>feedback triage</InlineLink> and <InlineLink href={KnownPages.FixVerification}>fix verification</InlineLink>.</p></Tile><Tile title="Check the boundaries"><p>Screen recordings are limited to 60 seconds and 25 MiB. Session replay, file proofing, satisfaction surveys and custom statuses are unavailable. Check <InlineLink href={KnownPageLinks.comparison('website-feedback-tools')}>the full feature matrix</InlineLink> before replacing a tool you rely on.</p></Tile><Tile title="Check installation and handoff"><p>See the <InlineLink href={KnownPages.BrowserExtension}>desktop extension</InlineLink>, <InlineLink href={KnownPages.Integrations}>integrations</InlineLink>, <InlineLink href={KnownPages.Ai}>coding-agent workflow</InlineLink> and <InlineLink href={KnownPages.PageChecks}>page-check limits</InlineLink>.</p></Tile></Panel>
            <Button variant="solid" href={KnownPages.App} className="self-start">Try uier on a page</Button>
        </PageSection>
    </main>;
}
