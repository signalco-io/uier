import { ArrowRight, Check, CircleHelp, CircleMinus, Info } from 'lucide-react';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { InlineLink, PageHeader, PageSection, Panel, Tile } from '../ContentPage';
import { ComparisonCover } from './ComparisonCover';
import { WorkflowPicture } from './WorkflowPicture';
import { competitors, competitorSlugs, dimensions, uier, uierProofSources, type CompetitorSlug, type Fact, type Product, type Support } from './content';

const statusIcons = { yes: Check, limited: Info, no: CircleMinus, unknown: CircleHelp };
const statusLabels: Record<Support, string> = { yes: 'Available', limited: 'Has limits', no: 'Not supported', unknown: 'Not verified' };
const choiceTitles: Record<CompetitorSlug, string> = {
    bugherd: 'Choose BugHerd for custom task workflows',
    'marker-io': 'Choose Marker.io for bug reproduction',
    usersnap: 'Choose Usersnap for product research',
    pastel: 'Choose Pastel for PDFs and HTML prototypes',
    userback: 'Choose Userback for product-feedback evidence',
    ruttl: 'Choose ruttl for website projects and file review'
};

function SupportIcon({ support }: { support: Support }) {
    const Icon = statusIcons[support];
    return <Icon size={16} strokeWidth={1.75} aria-hidden="true" className={`mt-0.5 shrink-0${support === 'yes' ? ' text-[hsl(var(--brand-success))]' : ''}`} />;
}

function FactCell({ fact, product, dimension, compact }: { fact: Fact; product: string; dimension: string; compact?: boolean }) {
    const detail = <>
        <p className="text-xs leading-relaxed text-muted-foreground">{fact.detail}</p>
        {fact.source && <a href={fact.source} aria-label={`${product}: source for ${dimension.toLowerCase()}`} className="inline-flex min-h-8 items-center text-xs font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">Source</a>}
        {fact.additionalSource && <p className="text-xs"><InlineLink href={fact.additionalSource.url}>{fact.additionalSource.label}</InlineLink></p>}
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
        {/* Keep the absolutely positioned screen-reader labels inside this scroll surface. */}
        <div role="region" aria-label="Feature comparison table" aria-describedby="matrix-help" tabIndex={0} className="relative min-w-0 max-w-full overflow-x-auto rounded-2xl border focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <table className={`w-full table-fixed border-collapse text-left ${compact ? 'min-w-[1440px]' : 'min-w-[600px]'}`}>
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
    return <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">Written by uier. Dates beside individual sources apply to those sources. This is a comparison of documented capabilities, not a hands-on benchmark. Features and plan entitlements can change; the source links let you check them. MCP access is available in several tools and does not automatically fix code.</p>;
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
            <div><dt className="font-medium">Integrations</dt><dd className="mt-1 text-muted-foreground">{product.integrations} <InlineLink href={product.integrationUrl}>{product.name} integrations</InlineLink></dd></div>
            <div><dt className="font-medium">Pricing model</dt><dd className="mt-1 text-muted-foreground">{product.pricing} <InlineLink href={product.pricingUrl}>Current {product.name} pricing</InlineLink></dd></div>
        </dl>
    </div>;
}

function Sources({ products }: { products: Product[] }) {
    return <Panel className={products.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'}>
        {products.map(product => <div key={product.name} className="p-6">
            <h3 className="text-base font-semibold">{product.name}</h3>
            <p className="mt-2 text-xs text-muted-foreground">General sources checked <time dateTime={product.reviewed.date}>{product.reviewed.label}</time>.</p>
            <ul className="mt-3 flex flex-col gap-3 text-sm">{product.sources.map(source => <li key={source.url}>
                <InlineLink href={source.url}>{source.label}</InlineLink>
                {source.reviewed && <span className="text-xs text-muted-foreground"> (checked <time dateTime={source.reviewed.date}>{source.reviewed.label}</time>)</span>}
            </li>)}</ul>
        </div>)}
    </Panel>;
}

function RelatedComparisons({ except }: { except?: CompetitorSlug }) {
    return <Panel className="sm:grid-cols-2">
        {competitorSlugs.filter(slug => slug !== except).map(slug => <div key={slug} className="flex flex-col gap-2 p-6">
            <h3 className="text-base font-semibold"><InlineLink href={KnownPageLinks.comparison(slug)}>uier vs {competitors[slug].name}</InlineLink></h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{competitors[slug].bestFor}</p>
        </div>)}
        {except && <div className="flex flex-col gap-2 p-6"><h3 className="text-base font-semibold"><InlineLink href={KnownPageLinks.comparison('website-feedback-tools')}>Compare all seven tools</InlineLink></h3><p className="text-sm leading-relaxed text-muted-foreground">See capture, editing, proofing, workflow and research capabilities in one matrix.</p></div>}
    </Panel>;
}

const tradeoffs: Record<CompetitorSlug, { keep: string; withUier: string; test: string }> = {
    bugherd: {
        keep: 'Use BugHerd if your team depends on recorded audio, PDF review, task due dates or custom Kanban columns.',
        withUier: 'Both tools review images and selected Figma screens. In uier, statuses sit within five fixed stages. Deadlines apply to file approval rounds. Tasks have no due dates.',
        test: 'Try one client review from first comment to a checked fix. If you review designs, try a Figma frame import and resync on a project with that format enabled. Check whether uier can send feedback to your team’s project tool or let you read it in your coding tool through MCP.'
    },
    'marker-io': {
        keep: 'Use Marker.io if replay, console/network evidence and scheduled monitoring are requirements.',
        withUier: 'uier supports screenshots, short screen recordings and browser context. Replay, console logs and network requests are unavailable. Page checks run on the reviewed page.',
        test: 'Report a real bug with the same browser and site login. Try a written reproduction and recording before replacing your existing diagnostics workflow.'
    },
    usersnap: {
        keep: 'Use Usersnap if your program needs satisfaction surveys, targeted feedback collection, public voting or product opportunities.',
        withUier: 'uier covers on-page review, short screen recordings and resolving the resulting threads. It has no survey builder, public request board, opportunity model or native mobile SDK.',
        test: 'Separate website review from product research. Try uier for the review portion while retaining the surveys, voting or mobile collection tools your team still needs.'
    },
    pastel: {
        keep: 'With Pastel, clients can review an HTML prototype before you have a staging site. They can also review PDFs, images, videos and emails, and approve a specific version.',
        withUier: 'Enable the formats your project needs to review images, selected Figma frames, EML uploads and MP4, ProRes MOV or WebM videos. Resync a Figma frame under the same review link, even after a rename. Existing threads keep their original version and location. Named reviewers decide on the whole version in a separate approval round.',
        test: 'Share an EML upload with a client, then upload a revision and ask your reviewers to decide on the new version. If you also review live websites, test the installation and login there.'
    },
    userback: {
        keep: 'Keep Userback when your product-feedback program relies on session replay, console/network evidence, surveys, a feature portal or its specific integration automations.',
        withUier: 'uier supports anchored review, drawings, saved message images, short recordings, custom statuses and agent access. It does not replace replay, developer diagnostics, surveys or a public request board.',
        test: 'Report a product bug in both tools. Compare the evidence a developer receives, check your plan’s feedback availability and test the destination. Use the same login and browser rather than assuming every capture path is equivalent.'
    },
    ruttl: {
        keep: 'Keep ruttl for its website project edit mode, PDF review, task deadlines or specific integrations. Its web app projects provide a separate feedback workflow.',
        withUier: 'uier saves proposed text and supported styles on a single element for your team to implement in source. You can review images and run version approvals with project-enabled formats. Deadlines apply to approval rounds. Tasks have no due dates.',
        test: 'Try the same text and style proposal on a client page. Check how reviewers open it and hand off exact values. Test guest access and any login-protected pages with the intended installation. Confirm plan allowances for users, guests, storage and integrations.'
    }
};

const examples: Partial<Record<CompetitorSlug, { title: string; situation: string; alternative: string; review: string }>> = {
    userback: {
        title: 'A checkout report needs reproduction evidence',
        situation: 'On a fictional restaurant’s ordering app, a customer reports that changing the collection time clears the basket. A screenshot alone does not show the sequence.',
        alternative: 'With the appropriate Userback plan and widget settings, inspect the feedback replay and diagnostics, assign the item and use an MCP client to inspect context or propose a workflow update.',
        review: 'In uier, pin a report to the collection-time field, write the steps and expected result, and attach a short recording. Discuss it in the thread, assign the fix and request human verification if the project has enabled it. Keep a separate diagnostic tool if logs or replay are required.'
    },
    ruttl: {
        title: 'A client wants to show a layout change',
        situation: 'For a fictional restaurant’s launch, the client wants a shorter booking button label and more padding on its sides. The team also needs feedback on a separate PDF menu.',
        alternative: 'In a ruttl website project, demonstrate the button changes on the page and assign the task to a developer. Collect PDF comments in a separate file review.',
        review: 'In uier, point at the booking button and choose Suggest a change. Enter the shorter label and the side padding, then preview both on the page. Post the suggestion so the developer can copy the exact values and implement them in source. Use a separate tool to review the PDF.'
    }
};

export function PairComparisonPage({ slug }: { slug: CompetitorSlug }) {
    const competitor = competitors[slug];
    const tradeoff = tradeoffs[slug];
    const example = examples[slug];
    return <main className="flex min-w-0 flex-col pb-16">
        <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-16">
            <PageHeader title={`uier vs ${competitor.name}`} lead={`An honest look at uier as a ${competitor.name} alternative: what overlaps, where the workflows differ and what you would give up.`}>
                <div className="flex flex-wrap gap-2.5"><Button variant="solid" size="lg" href="#choose">Which fits your work?</Button><Button variant="outlined" size="lg" href="#features">Compare features</Button></div>
            </PageHeader>
            <ComparisonCover slug={slug} />
        </div>

        <PageSection id="choose" title="Choose by the work you need to finish" lead="Both tools collect visual feedback. The difference is what you need around that feedback." wide>
            <div className="flex flex-col gap-1">
                <Panel className="md:grid-cols-2"><ProductChoice product={uier} title="Choose uier for live-page review" /><ProductChoice product={competitor} title={choiceTitles[slug]} /></Panel>
                <p className="text-xs text-muted-foreground">Conceptual workflow illustrations, not product screenshots. No scores or rankings.</p>
            </div>
        </PageSection>

        <PageSection id="features" title="The feature comparison" lead="A check is a documented capability. The scope beside it matters just as much." wide>
            <FeatureMatrix products={[uier, competitor]} />
        </PageSection>

        {example && <PageSection id="example" title={example.title} lead={example.situation}>
            <Panel><Tile title={`In ${competitor.name}`}><p>{example.alternative}</p></Tile><Tile title="In uier"><p>{example.review}</p></Tile></Panel>
            <p className="text-sm leading-relaxed text-muted-foreground">A fictional example, not a customer result. See <InlineLink href={KnownPages.ClientFeedback}>client website feedback</InlineLink>, <InlineLink href={KnownPages.BugReporting}>website bug reporting</InlineLink> and <InlineLink href={KnownPages.UserAcceptanceTesting}>manual acceptance review</InlineLink>.</p>
        </PageSection>}

        <PageSection id="tradeoffs" title="What changes if you switch" lead="Check the workflows you rely on before switching.">
            <Panel><Tile title={`Reasons to keep ${competitor.name}`}><p>{tradeoff.keep}</p></Tile><Tile title="How the work changes in uier"><p>{tradeoff.withUier}</p></Tile><Tile title="What to try before deciding"><p>{tradeoff.test}</p></Tile></Panel>
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
            <p className="text-sm leading-relaxed text-muted-foreground">See <InlineLink href={KnownPages.FixVerification}>fix verification</InlineLink>, <InlineLink href={KnownPages.PageChecks}>page checks and their limits</InlineLink>, <InlineLink href={KnownPages.Ai}>the coding-agent workflow</InlineLink> or the <InlineLink href={KnownPages.McpGuide}>MCP setup guide</InlineLink>.</p>
        </PageSection>

        <PageSection id="related" title="Other alternatives" lead={<InlineLink href={KnownPages.Compare}>Back to the comparison guide</InlineLink>} wide><RelatedComparisons except={slug} /></PageSection>
    </main>;
}

export function AllToolsPage() {
    const products: Product[] = [uier, ...competitorSlugs.map(slug => competitors[slug])];
    return <main className="flex min-w-0 flex-col pb-16">
        <PageHeader title="Website feedback tools compared" lead="Seven tools for overlapping jobs: live-page review, bug reproduction, visual changes, product research and asset approval. Choose the workflow first.">
            <div className="flex flex-wrap gap-2.5"><Button variant="solid" size="lg" href="#features">Open the feature matrix</Button><Button variant="outlined" size="lg" href={KnownPages.Compare}>Comparison guide</Button></div>
        </PageHeader>

        <PageSection id="workflows" title="Different tools, different finish lines" lead="These pictures show the job each tool can help with. They are not replicas of the products." wide>
            <Panel className="md:grid-cols-2 lg:grid-cols-3">{products.map(product => <ProductChoice key={product.name} product={product} title={product.name} />)}</Panel>
        </PageSection>

        <PageSection id="features" title="Compare the actual capabilities" lead="No overall winner. Unsupported and unverified capabilities stay visible alongside supported ones." wide><FeatureMatrix products={products} compact /></PageSection>

        <PageSection id="gaps" title="Where the workflows differ" lead="Check the formats, capture modes and deadlines your team relies on.">
            <Panel>
                <Tile title="Reproduce a sequence"><p>uier supports short screen recordings with explicit permission. Built-in capture has no audio and ends on full-page navigation. Session replay, console logs and network capture are unavailable. Marker.io and Userback document replay and diagnostics. BugHerd and Usersnap document recording.</p></Tile>
                <Tile title="Approve a file version"><p>With project-enabled formats, uier supports images, selected Figma frames, EML uploads and MP4, ProRes MOV or WebM videos. Reviewers can approve each version separately. Pastel also documents PDF and uploaded HTML review. BugHerd lists file and Figma review. ruttl lists image and PDF review.</p></Tile>
                <Tile title="Run product research"><p>uier has no satisfaction surveys, public voting or roadmap. Usersnap and Userback document product-research capabilities alongside visual feedback.</p></Tile>
                <Tile title="Organize work and deadlines"><p>uier groups up to 30 custom statuses under Open, In progress, Ready to verify, Done and Archive. You can set deadlines on file approval rounds. BugHerd supports custom board columns with task due dates.</p></Tile>
                <Tile title="Publish text and style changes"><p>uier lets reviewers preview proposed text and supported styles on the page. Your team copies the exact values, implements the change in source and publishes it through your usual process.</p></Tile>
            </Panel>
        </PageSection>

        <PageSection id="setup" title="The practical differences" lead="Plan limits, reviewer access and integration behavior can change the decision." wide><Panel className="md:grid-cols-2">{products.map(product => <ProductPracticalities key={product.name} product={product} />)}</Panel></PageSection>

        <PageSection id="sources" title="Sources and scope" lead="Unknown is not a missing feature. We do not mark a competitor unsupported just because a page did not mention a capability." wide><Sources products={products} /><MethodNote /></PageSection>

        <PageSection id="related" title="Go deeper on one alternative" lead="Each comparison includes the tradeoffs and a practical check before switching." wide><RelatedComparisons /></PageSection>
    </main>;
}

export function ComparisonHub() {
    return <main className="flex min-w-0 flex-col pb-16">
        <PageHeader title="Find the right website feedback tool" lead="Compare uier with BugHerd, Marker.io, Usersnap, Pastel, Userback and ruttl by the work you need to finish, including where another tool fits better.">
            <div className="flex flex-wrap gap-2.5"><Button variant="solid" size="lg" href={KnownPageLinks.comparison('website-feedback-tools')}>Compare all seven tools</Button><Button variant="outlined" size="lg" href="#alternatives">Explore alternatives</Button></div>
        </PageHeader>

        <PageSection id="start" title="Start with the job" lead="A screenshot, a replay and an approval answer different questions." wide>
            <Panel className="md:grid-cols-3">
                <div><WorkflowPicture kind="review" /><div className="flex flex-col gap-3 p-6"><h3 className="text-xl font-semibold tracking-tight">Review a live website</h3><p className="text-sm leading-relaxed text-muted-foreground">Preview proposed text and style changes on the page, discuss the suggestion and check the fix. Compare uier’s review workflow with BugHerd, Pastel and ruttl.</p><InlineLink href={KnownPageLinks.comparison('bugherd')}>Compare website review <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" className="inline" /></InlineLink></div></div>
                <div><WorkflowPicture kind="diagnostics" /><div className="flex flex-col gap-3 p-6"><h3 className="text-xl font-semibold tracking-tight">Reproduce a bug</h3><p className="text-sm leading-relaxed text-muted-foreground">Capture what happened, not only how the page looked. Marker.io, Usersnap and Userback offer capture capabilities uier does not.</p><InlineLink href={KnownPageLinks.comparison('marker-io')}>Compare bug evidence <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" className="inline" /></InlineLink></div></div>
                <div><WorkflowPicture kind="proofing" /><div className="flex flex-col gap-3 p-6"><h3 className="text-xl font-semibold tracking-tight">Approve a file version</h3><p className="text-sm leading-relaxed text-muted-foreground">In uier, review images, selected Figma frames, EML uploads and MP4, ProRes MOV or WebM videos where enabled. Request approval on a specific version. Pastel also documents PDF and uploaded HTML review.</p><InlineLink href={KnownPageLinks.comparison('pastel')}>Compare asset review <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" className="inline" /></InlineLink></div></div>
            </Panel>
        </PageSection>

        <PageSection id="alternatives" title="Compare one alternative" lead="Read the overlap, the missing capabilities and the practical differences side by side." wide><RelatedComparisons /></PageSection>

        <PageSection id="limits" title="Where uier fits" lead="Live website review and project-enabled file proofing.">
            <Panel>
                <Tile title="See the review workflow"><p>Start with the <InlineLink href={KnownPages.ClientReviewGuide}>client review guide</InlineLink>, <InlineLink href={`${KnownPages.PinnedComments}#preview-a-change`}>on-page previews</InlineLink>, <InlineLink href={KnownPages.FeedbackTriage}>feedback triage</InlineLink> and <InlineLink href={KnownPages.FixVerification}>fix verification</InlineLink>.</p></Tile>
                <Tile title="Share a file and collect decisions"><p>Keep the same review link as you publish revisions. A thread keeps its original version and location. See the <InlineLink href={uierProofSources.viewer}>file viewer</InlineLink> and <InlineLink href={uierProofSources.approvals}>approval rounds</InlineLink>.</p></Tile>
                <Tile title="Check the boundaries"><p>Screen recordings are limited to 60 seconds and 25 MiB. Session replay, console and network capture, and satisfaction surveys are unavailable. Check <InlineLink href={KnownPageLinks.comparison('website-feedback-tools')}>the full feature matrix</InlineLink> before replacing a tool you rely on.</p></Tile>
                <Tile title="Check installation and handoff"><p>See the <InlineLink href={KnownPages.BrowserExtension}>desktop extension</InlineLink>, <InlineLink href={KnownPages.Integrations}>integrations</InlineLink>, <InlineLink href={KnownPages.McpGuide}>MCP setup guide</InlineLink> and <InlineLink href={KnownPages.PageChecks}>page-check limits</InlineLink>.</p></Tile>
            </Panel>
            <Button variant="solid" href={KnownPages.App} className="self-start">Try uier on a page</Button>
        </PageSection>
    </main>;
}
