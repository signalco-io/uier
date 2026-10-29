'use client';

import { Separator } from '@/src/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/components/ui/tabs';
import { Button } from '@/src/components/ui/button';
import { mcpClientConfigurations } from '@/src/lib/mcp/clients';
import type { ConnectedAppView } from '@/src/lib/mcp/oauth/connectedApps';
import { feedbackSkill } from '@/src/lib/mcp/workflows';
import { Section } from '../PageHeader';
import { CopyBlock } from '../CopyBlock';
import { AccessTokens, type AccessToken } from './AccessTokens';
import { ConnectedApps } from './ConnectedApps';

const link = 'underline underline-offset-4';

/**
 * Account → Coding agents: connecting a coding tool (browser sign-in where it is verified), the
 * connected apps, and access tokens for environments without a browser.
 */
export function CodingAgents({ endpoint, apps, projects, credentials }: {
    endpoint: string;
    apps: ConnectedAppView[];
    projects: { id: string; name: string }[];
    credentials: AccessToken[];
}) {
    const skill = feedbackSkill();
    return <Section id="mcp" title="Coding agents" description="Connect a coding tool to feedback as your account. Choose exactly what it may access.">
        <div className="flex flex-col gap-6">
            <p className="m-0 text-sm text-muted-foreground">Your current project permissions always apply. Feedback sent to a coding tool is handled under that tool’s terms.</p>
            <ClientSetup endpoint={endpoint} />
            <Separator />
            <ConnectedApps apps={apps} />
            <Separator />
            <AccessTokens projects={projects} credentials={credentials} />
            <Separator />
            <details className="text-sm">
                <summary className="cursor-pointer font-medium">Prompts and agent skill</summary>
                <div className="mt-3 flex flex-col gap-3">
                    <p>Choose <code>triage-feedback</code> to group open threads, or <code>fix-feedback</code> to propose a code change in your client. Both leave uier unchanged. <code>report-back</code> drafts a reply or status change and waits for your approval before every write. It is available only with reply or status access.</p>
                    <p>Copy or download this skill and save it as <code>uier-feedback/SKILL.md</code> in your client’s skills folder. It uses the same workflow as the prompts.</p>
                    <Button asChild variant="outline" className="self-start"><a download="SKILL.md" href={`data:text/markdown;charset=utf-8,${encodeURIComponent(skill)}`}>Download SKILL.md</a></Button>
                    <details>
                        <summary className="cursor-pointer font-medium">View and copy SKILL.md</summary>
                        <div className="mt-3"><CopyBlock value={skill} label="Copy SKILL.md" /></div>
                    </details>
                </div>
            </details>
        </div>
    </Section>;
}

function ClientSetup({ endpoint }: { endpoint: string }) {
    const clients = mcpClientConfigurations(endpoint);
    return (
        <section aria-labelledby="connect-tool-title" className="flex flex-col gap-3 text-sm">
            <h3 id="connect-tool-title" className="m-0 text-sm font-semibold">Connect a coding tool</h3>
            <p className="m-0 text-muted-foreground">Add this Streamable HTTP endpoint to your coding tool. A tool that signs in with your browser opens uier, where you choose the workspaces, projects and operations it can use.</p>
            <CopyBlock value={endpoint} label="Copy MCP endpoint" />
            <Tabs defaultValue={clients[0]!.id}>
                <TabsList aria-label="Coding client" variant="line" className="flex-wrap max-w-full h-auto!">
                    {clients.map(client => <TabsTrigger key={client.id} value={client.id} className="min-h-11">{client.name}</TabsTrigger>)}
                </TabsList>
                {clients.map(client => <TabsContent key={client.id} value={client.id} className="flex flex-col gap-3">
                    {client.auth === 'oauth'
                        ? <>
                            <p className="m-0">Add uier in your terminal:</p>
                            <CopyBlock value={client.command} label={`Copy ${client.name} command`} />
                            <p className="m-0">Then run <code>/mcp</code> in {client.name}, choose uier and select Authenticate. Your browser opens uier, where you approve the connection.</p>
                            <p className="m-0 text-muted-foreground">Already added uier with an <code>Authorization</code> header, for example in <code>.mcp.json</code>? Remove that header first. {client.name} does not sign in while it is set. <a className={link} href={client.docs} target="_blank" rel="noreferrer">{client.name} documentation</a></p>
                        </>
                        : <>
                            <p className="m-0">Add to <code>{client.location}</code>. {client.name} uses an access token: create one under Access tokens below and set <code>UIER_MCP_TOKEN</code> in the environment that starts it. Merge the entry into your existing configuration. <a className={link} href={client.docs} target="_blank" rel="noreferrer">{client.name} documentation</a></p>
                            <CopyBlock value={client.configuration} label={`Copy ${client.name} MCP configuration`} />
                        </>}
                </TabsContent>)}
            </Tabs>
            <details>
                <summary className="cursor-pointer font-medium">Other clients</summary>
                <div className="mt-3 flex flex-col gap-3">
                    <p className="m-0">Claude on the web, desktop and mobile is not offered yet. Its custom connector has not been checked against uier’s sign-in. Request headers for custom connectors are in beta for a limited set of organizations. Where they are available on an individual plan, a custom connector can use the endpoint URL, No sign-in, and <code>Authorization: Bearer &lt;access token&gt;</code> under Request headers. Claude connects from Anthropic’s servers and cannot reach a local endpoint. Team and Enterprise plans would share your personal token, so do not use one there. <a className={link} href="https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers" target="_blank" rel="noreferrer">Claude connector documentation</a></p>
                    <p className="m-0">VS Code is not offered until a connection can be verified. Its <a className={link} href="https://code.visualstudio.com/docs/agents/reference/mcp-configuration" target="_blank" rel="noreferrer">MCP documentation</a> describes masked secret inputs.</p>
                    <p className="m-0">Windsurf is not offered until a connection can be verified. Its <a className={link} href="https://docs.devin.ai/desktop/cascade/mcp" target="_blank" rel="noreferrer">current documentation</a> describes legacy Cascade in Devin Desktop.</p>
                </div>
            </details>
        </section>
    );
}
