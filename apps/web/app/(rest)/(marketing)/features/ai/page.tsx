import { publicPageMetadata } from '@/src/lib/metadata';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { CheckList, InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../../src/components/marketing/ContentPage';
import { FaqPanel, type Question } from '../../../../../src/components/marketing/LandingFaq';
import { CodingAgentSpecimen, RewriteSpecimen } from '../../../../../src/components/marketing/AiSpecimens';
import { KnownPages } from '../../../../../src/knownPages';

// What uier does with AI today: the MCP connector for coding tools (docs/mcp.md; src/lib/mcp:
// server.ts for the tools, workflows.ts for the prompts and the skill, clients.ts for the clients
// Account offers; src/components/app/mcp/scopes.ts for the operation labels) and rewrite
// suggestions in the toolbar (src/lib/rewrite, packages/toolbar RewriteSuggestions), and its FAQ names AI thread
// titles (src/lib/titles). Change this page
// with them. Offer a client here only once Account offers it. The connector never confirms a fix
// (fix verification), and approval of each write happens in the coding tool, not in uier.

const title = 'AI for website feedback';

export const metadata = publicPageMetadata(KnownPages.Ai, {
    title,
    description: `Connect Claude Code, Codex or Cursor to your site's feedback with the access you choose. In the toolbar, AI suggests rewrites for selected text.`
});

const endpoint = `${brand.url}/api/mcp`;
const mcpGuide = `${brand.repository}/blob/main/docs/mcp.md`;

const steps = [
    {
        title: 'Connect your coding tool',
        text: `Add the ${brand.name} MCP server and sign in. You choose the workspaces, projects and operations it can use.`
    },
    {
        title: 'Read the feedback',
        text: 'Your agent searches the open threads and reads one with its page, anchor, browser details, discussion and screenshot: the same context as Copy issue.'
    },
    {
        title: 'Fix it in your code',
        text: `The agent proposes the change in your repository. Nothing changes in ${brand.name} while it works.`
    },
    {
        title: 'Report back',
        text: 'When you approve, it replies on the thread as you, labeled with the connection name, and marks the thread done.'
    }
];

// The operations of a connection, in the app's words (src/components/app/mcp/scopes.ts)
const operations: { label: string; text: string }[] = [
    { label: 'Read feedback', text: 'List, search and read threads with their context. Always included. Reading does not mark them read.' },
    { label: 'Read screenshots', text: 'Open the screenshots attached to feedback.' },
    { label: 'Reply to feedback', text: 'Post replies as you, labeled with the connection name.' },
    { label: 'Change status', text: 'Mark feedback in progress or done, open it again, and request or cancel a fix check.' },
    { label: 'Assign feedback', text: 'Assign feedback to people who can see it, and show your coding tool as the agent working on feedback assigned to you.' }
];

// The connector's prompts (src/lib/mcp/workflows.ts)
const prompts = [
    { name: 'triage-feedback', title: 'Triage feedback', text: 'Lists and groups the open threads of a project. Changes nothing.' },
    { name: 'fix-feedback', title: 'Propose a fix', text: `Reads one thread and proposes a code change in your coding tool. Leaves ${brand.name} as it was.` },
    { name: 'report-back', title: 'Report back', text: 'Drafts a reply or a status change and waits for your approval before it writes. Offered when the connection can reply or change status.' }
];

const rewrite = [
    'Select text on the page and choose Rewrite.',
    'Add an instruction if you like, such as shorter or friendlier, and choose Suggest.',
    'Pick one of up to three suggestions. It goes into the text box, where you can edit it before you post the suggestion.'
];

const tryIt = [
    'Sign in and create a project for your site.',
    'In Account, open Coding agents and set up your coding tool.',
    'Ask your agent to triage the open feedback, or to fix one thread.'
];

const questions: Question[] = [
    {
        question: 'Which coding tools can connect?',
        answer: <>Claude Code signs in through your browser. Codex and Cursor use an access token from Account → Coding agents. Other tools are added there once their connection has been checked. The <InlineLink href={mcpGuide}>MCP guide</InlineLink> has the details.</>
    },
    {
        question: `Does ${brand.name} send my feedback to an AI model?`,
        answer: <>Not through the MCP connector: your coding tool reads the feedback and handles it under its own terms, including what it sends to its model. Rewrite suggestions send the selected text and your instruction to Anthropic. Thread titles send each thread&rsquo;s first message to Anthropic, whose Claude Haiku writes a short title for lists, unless an admin turns them off. The <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> has the details.</>
    },
    {
        question: 'Can an agent change things without asking?',
        answer: <>A connection can do only what you allowed when it connected, and it is read-only unless you allow more. The prompts and the skill ask for your approval before every write, but the approval happens in your coding tool, so keep its own approval settings on.</>
    },
    {
        question: 'Can an agent confirm a fix?',
        answer: <>No. With Change status it can request or cancel a fix check after you approve that action. Only the reviewer confirms a fix; <InlineLink href={KnownPages.FixVerification}>Fix verification</InlineLink> explains how.</>
    },
    {
        question: 'Does reading feedback mark it as read?',
        answer: <>No. Threads your agent reads stay unread for you in the app and in the toolbar.</>
    },
    {
        question: 'What does it cost?',
        answer: <>Nothing. {brand.pricing}</>
    }
];

const code = 'font-mono text-[0.875em]';

export default function AiPage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Hand the feedback to your coding agent"
                lead="Connect Claude Code, Codex or Cursor to your site's feedback. Your agent reads each thread with its page, anchor and screenshot, and reports back when you approve.">
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={KnownPages.App}>Get started</Button>
                    <Button variant="outlined" size="lg" href="#connect">Connect a coding tool</Button>
                </div>
            </PageHeader>

            <PageSection
                id="how-it-works"
                title="How it works"
                lead={`The ${brand.name} MCP connector lets your coding tool read feedback and, if you allow it, reply, change status and assign. It cannot edit code, run commands or deploy.`}>
                <CodingAgentSpecimen />
                <Panel as="ol">
                    {steps.map((step, index) => (
                        <li key={step.title} className="flex items-baseline gap-4 p-6">
                            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                            <span className="flex flex-col gap-1">
                                <span className="text-base font-semibold">{step.title}</span>
                                <span className="text-sm leading-relaxed text-muted-foreground">{step.text}</span>
                            </span>
                        </li>
                    ))}
                </Panel>
            </PageSection>

            <PageSection
                id="connect"
                title="Connect your coding tool"
                lead={<>Every tool uses one endpoint, <code className={code}>{endpoint}</code>. The setup for each is in the app, under Account → Coding agents.</>}>
                <Panel className="md:grid-cols-2">
                    <div className="md:col-span-2">
                        <Tile title="Claude Code" label="Signs in with your browser">
                            <p>Add {brand.name} in your terminal, then run <code className={code}>/mcp</code>, choose {brand.name} and select Authenticate. {brand.name} opens in your browser, where you choose what the tool can reach and approve the connection.</p>
                            {/* Wraps instead of scrolling: a scrolling block would need its own keyboard focus */}
                            <pre className="whitespace-pre-wrap rounded-xl border bg-muted/50 px-4 py-3 font-mono text-xs text-foreground [overflow-wrap:anywhere]"><code>claude mcp add --transport http {brand.name} {endpoint}</code></pre>
                        </Tile>
                    </div>
                    <Tile title="Codex" label="Access token">
                        <p>Create an access token in Account and add {brand.name} to <code className={code}>~/.codex/config.toml</code>. The token stays in the <code className={code}>UIER_MCP_TOKEN</code> environment variable, not in the file.</p>
                    </Tile>
                    <Tile title="Cursor" label="Access token">
                        <p>Add {brand.name} to <code className={code}>.cursor/mcp.json</code> with the token from the same environment variable.</p>
                    </Tile>
                </Panel>
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    An access token also works where no browser can sign in, such as SSH sessions, containers and CI. It lasts 30 days and reaches up to 20 projects in one workspace. Other tools are added to Account once their connection has been checked.
                </p>
            </PageSection>

            <PageSection
                id="operations"
                title="What your agent can do"
                lead="A connection is read-only unless you allow more. You choose its operations when it connects, and they apply to everything it reaches.">
                <div className="overflow-hidden rounded-2xl border">
                    <table className="w-full border-collapse text-left text-sm">
                        <caption className="sr-only">Operations a coding tool connection can have and what each allows</caption>
                        <thead className="bg-muted/50">
                            <tr>
                                <th scope="col" className="p-3 font-semibold md:p-4">Operation</th>
                                <th scope="col" className="p-3 font-semibold md:p-4">What it allows</th>
                            </tr>
                        </thead>
                        <tbody>
                            {operations.map(row => (
                                <tr key={row.label} className="border-t align-top">
                                    <th scope="row" className="p-3 font-medium md:p-4">{row.label}</th>
                                    <td className="p-3 text-muted-foreground md:p-4">{row.text}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    The connector cannot edit code, run commands, deploy, delete feedback or confirm a fix. Your coding tool changes code under its own permissions. A retried reply or status change is saved once.
                </p>
            </PageSection>

            <PageSection
                id="prompts"
                title="Prompts and a skill"
                lead="Start a workflow from your coding tool's prompt menu, or save the skill so your agent follows the same steps.">
                <Panel as="ul">
                    {prompts.map(prompt => (
                        <li key={prompt.name} className="flex flex-col gap-1 p-6">
                            <span className="font-mono text-xs text-muted-foreground">{prompt.name}</span>
                            <span className="text-base font-semibold">{prompt.title}</span>
                            <span className="text-sm leading-relaxed text-muted-foreground">{prompt.text}</span>
                        </li>
                    ))}
                </Panel>
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    Copy or download the <code className={code}>uier-feedback</code> skill in Account → Coding agents and save it in your tool&rsquo;s skills folder. The prompts and the skill cite each thread by its {brand.name} link in pull requests and commits. The skill also shows your agent how to watch a project for new feedback, replies and status changes from a looping or scheduled task.
                </p>
            </PageSection>

            <PageSection
                id="control"
                title="You stay in control"
                lead="A connection works as your account, within the access you gave it.">
                <Panel className="md:grid-cols-2">
                    <Tile title="Never more than you can do">
                        <p>Your current permissions are checked on every request. If you lose access to a project or a private thread, so does the connection.</p>
                    </Tile>
                    <Tile title="Only what you choose">
                        <p>All your workspaces and projects, including new ones, or only the ones you pick. Consent is shown every time a tool connects.</p>
                    </Tile>
                    <Tile title="Feedback is data, not instructions">
                        <p>The connector marks feedback as untrusted content and tells your agent to treat what reviewers wrote as text to read, not commands to follow.</p>
                    </Tile>
                    <Tile title="Revoke at any time">
                        <p>Account → Coding agents lists your connections. Revoking one ends its access on the next request. It cannot take back what the tool already received.</p>
                    </Tile>
                </Panel>
            </PageSection>

            <PageSection
                id="rewrite-suggestions"
                title="Rewrite suggestions"
                lead="When a reviewer wants different wording on the page, AI can suggest it. Try it here: select any sentence on this page.">
                <RewriteSpecimen />
                <CheckList items={rewrite} />
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    Anthropic&rsquo;s Claude writes the suggestions from the selected text and your instruction, which are not stored; only what you post is saved. Suggestions work on selections of up to 1,000 characters and have hourly and daily limits. You can always write your own.
                </p>
            </PageSection>

            <PageSection
                id="try-it"
                title="Try it"
                lead="The MCP connector works with your projects. Set it up once and your agent can reach every project you allow.">
                <ol className="flex flex-col gap-4">
                    {tryIt.map((step, index) => (
                        <li key={step} className="flex items-baseline gap-4">
                            <span aria-hidden="true" className="font-mono text-xs text-muted-foreground">0{index + 1}</span>
                            <span className="text-base">{step}</span>
                        </li>
                    ))}
                </ol>
                <Button variant="solid" href={KnownPages.App} className="self-start">Create a project</Button>
            </PageSection>

            <PageSection
                id="faq"
                title="Questions"
                lead={<>More about {brand.name} in the <InlineLink href={KnownPages.Faq}>main questions</InlineLink>.</>}>
                <FaqPanel questions={questions} />
            </PageSection>
        </main>
    );
}
