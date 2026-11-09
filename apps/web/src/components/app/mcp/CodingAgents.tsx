'use client';

import type { ReactNode } from 'react';
import { DownloadIcon } from 'lucide-react';
import { inferAgentKind } from '@uier/toolbar/agents';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/components/ui/tabs';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { mcpClientConfigurations } from '@/src/lib/mcp/clients';
import type { ConnectedAppView } from '@/src/lib/mcp/oauth/connectedApps';
import { feedbackSkill } from '@/src/lib/mcp/workflows';
import { AgentMark } from '../comments/AgentAvatar';
import { Section } from '../PageHeader';
import { CopyBlock } from '../CopyBlock';
import { AccessTokens, type AccessToken } from './AccessTokens';
import { ConnectedApps } from './ConnectedApps';

const link = 'underline underline-offset-4 hover:text-foreground';

/**
 * Account → Coding agents: the connected apps, connecting a coding tool (browser sign-in where it is
 * verified), access tokens for environments without a browser, and the prompts and skill. One card each.
 */
export function CodingAgents({ endpoint, apps, projects, credentials }: {
    endpoint: string;
    apps: ConnectedAppView[];
    projects: { id: string; name: string }[];
    credentials: AccessToken[];
}) {
    return (
        <section aria-label="Coding agents" className="flex flex-col gap-6">
            <ConnectedApps apps={apps} />
            <ClientSetup endpoint={endpoint} />
            <AccessTokens projects={projects} credentials={credentials} />
            <PromptsAndSkill />
        </section>
    );
}

/** A numbered step of a client's setup: what to do, then the details or the code to copy */
function Step({ number, title, children }: { number: number; title: ReactNode; children?: ReactNode }) {
    return (
        <li className="flex gap-3">
            <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums">{number}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                <p className="m-0 font-medium">{title}</p>
                {children}
            </div>
        </li>
    );
}

function ClientSetup({ endpoint }: { endpoint: string }) {
    const clients = mcpClientConfigurations(endpoint);
    return (
        <Section id="connect" title="Connect a coding tool"
            description="It works with feedback as your account. A tool that signs in with your browser opens uier, where you choose the workspaces, projects and operations it can use.">
            <div className="flex flex-col gap-6 text-sm">
                <div className="flex flex-col gap-2">
                    <p className="m-0 text-muted-foreground">Add this Streamable HTTP endpoint to your coding tool:</p>
                    <CopyBlock value={endpoint} label="Copy MCP endpoint" />
                </div>
                <Tabs defaultValue={clients[0]!.id} className="gap-4">
                    <TabsList aria-label="Coding client" variant="line" className="h-auto! max-w-full flex-wrap">
                        {clients.map(client => <TabsTrigger key={client.id} value={client.id} className="min-h-11">
                            <AgentMark kind={inferAgentKind(client.name)} />
                            {client.name}
                        </TabsTrigger>)}
                    </TabsList>
                    {clients.map(client => <TabsContent key={client.id} value={client.id} className="flex flex-col gap-4">
                        {client.auth === 'oauth'
                            ? <>
                                <ol className="m-0 flex list-none flex-col gap-4 p-0">
                                    <Step number={1} title="Add uier in your terminal">
                                        <CopyBlock value={client.command} label={`Copy ${client.name} command`} />
                                    </Step>
                                    <Step number={2} title={<>Run <code>/mcp</code> in {client.name}, choose uier and select Authenticate</>}>
                                        <p className="m-0 text-muted-foreground">Your browser opens uier, where you approve the connection. It then shows up under Connected apps.</p>
                                    </Step>
                                </ol>
                                <p className="m-0 text-muted-foreground">Already added uier with an <code>Authorization</code> header, for example in <code>.mcp.json</code>? Remove that header first. {client.name} does not sign in while it is set. <a className={link} href={client.docs} target="_blank" rel="noreferrer">{client.name} documentation</a></p>
                            </>
                            : <>
                                <ol className="m-0 flex list-none flex-col gap-4 p-0">
                                    <Step number={1} title="Create an access token">
                                        <p className="m-0 text-muted-foreground">{client.name} uses an access token. Create one under <a className={link} href="#access-tokens">Access tokens</a> below.</p>
                                    </Step>
                                    <Step number={2} title={<>Set <code>UIER_MCP_TOKEN</code></>}>
                                        <p className="m-0 text-muted-foreground">Set it in the environment that starts {client.name}.</p>
                                    </Step>
                                    <Step number={3} title={<>Add uier to <code>{client.location}</code></>}>
                                        <p className="m-0 text-muted-foreground">Merge the entry into your existing configuration.</p>
                                        <CopyBlock value={client.configuration} label={`Copy ${client.name} MCP configuration`} />
                                    </Step>
                                </ol>
                                <p className="m-0 text-muted-foreground"><a className={link} href={client.docs} target="_blank" rel="noreferrer">{client.name} documentation</a></p>
                            </>}
                    </TabsContent>)}
                </Tabs>
                <details className="rounded-lg border">
                    <summary className="cursor-pointer px-4 py-3 font-medium">Other clients</summary>
                    <div className="flex flex-col gap-3 px-4 pb-4 text-muted-foreground">
                        <p className="m-0">Claude on the web, desktop and mobile is not offered yet. Its custom connector has not been checked against uier’s sign-in. Request headers for custom connectors are in beta for a limited set of organizations. Where they are available on an individual plan, a custom connector can use the endpoint URL, No sign-in, and <code>Authorization: Bearer &lt;access token&gt;</code> under Request headers. Claude connects from Anthropic’s servers and cannot reach a local endpoint. Team and Enterprise plans would share your personal token, so do not use one there. <a className={link} href="https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers" target="_blank" rel="noreferrer">Claude connector documentation</a></p>
                        <p className="m-0">VS Code is not offered until a connection can be verified. Its <a className={link} href="https://code.visualstudio.com/docs/agents/reference/mcp-configuration" target="_blank" rel="noreferrer">MCP documentation</a> describes masked secret inputs.</p>
                        <p className="m-0">Windsurf is not offered until a connection can be verified. Its <a className={link} href="https://docs.devin.ai/desktop/cascade/mcp" target="_blank" rel="noreferrer">current documentation</a> describes legacy Cascade in Devin Desktop.</p>
                    </div>
                </details>
                <p className="m-0 text-xs text-muted-foreground">Feedback sent to a coding tool is handled under that tool’s terms.</p>
            </div>
        </Section>
    );
}

/** uier's MCP prompts, and the same workflow as a skill to save in the client */
const prompts = [
    { name: 'triage-feedback', description: 'Groups open threads. Leaves uier unchanged.' },
    { name: 'fix-feedback', description: 'Proposes a code change in your client. Leaves uier unchanged.' },
    { name: 'report-back', description: 'Drafts a reply or status change and waits for your approval before every write. Available only with reply or status access.' }
];

function PromptsAndSkill() {
    const skill = feedbackSkill();
    return (
        <Section id="skill" title="Prompts and agent skill" description="Prompts a connected coding tool can use, and a skill with the same workflow.">
            <div className="flex flex-col gap-4 text-sm">
                <ul aria-label="Prompts" className="m-0 flex list-none flex-col divide-y rounded-lg border p-0">
                    {prompts.map(prompt => <li key={prompt.name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
                        <code className="shrink-0 text-[13px] sm:w-36">{prompt.name}</code>
                        <span className="text-muted-foreground">{prompt.description}</span>
                    </li>)}
                </ul>
                <p className="m-0">Copy or download this skill and save it as <code>uier-feedback/SKILL.md</code> in your client’s skills folder. It uses the same workflow as the prompts.</p>
                <a download="SKILL.md" href={`data:text/markdown;charset=utf-8,${encodeURIComponent(skill)}`} className={cn(buttonVariants({ variant: 'outline' }), 'self-start')}>
                    <DownloadIcon data-icon="inline-start" />
                    Download SKILL.md
                </a>
                <details>
                    <summary className="cursor-pointer font-medium">View and copy SKILL.md</summary>
                    <div className="mt-3"><CopyBlock value={skill} label="Copy SKILL.md" /></div>
                </details>
            </div>
        </Section>
    );
}
