'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

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
 * verified), optional repository plugins, access tokens, and the prompts and skill. One card each.
 */
export function CodingAgents({ endpoint, apps, projects, credentials }: {
    endpoint: string;
    apps: ConnectedAppView[];
    projects: { id: string; name: string }[];
    credentials: AccessToken[];
}) {
    const { t } = useAppI18n();
    return (
        <section aria-label={t("Coding agents")} className="flex flex-col gap-6">
            <ConnectedApps apps={apps} />
            <PluginSetup />
            <ClientSetup endpoint={endpoint} />
            <AccessTokens projects={projects} credentials={credentials} />
            <PromptsAndSkill />
        </section>
    );
}

/** Both repository marketplaces install the same skills and the public uier MCP connector. */
function PluginSetup() {
    const { t } = useAppI18n();
    return (
        <Section id="plugins" title={t("Install the uier plugin")}
            description={t("Get the MCP connector and the uier-monitor skills together for Claude Code or Codex.")}>
            <div className="flex flex-col gap-4 text-sm">
                <Tabs defaultValue="claude-plugin" className="gap-4">
                    <TabsList aria-label={t("Plugin client")} variant="line" className="h-auto! max-w-full flex-wrap">
                        <TabsTrigger value="claude-plugin" className="min-h-11"><AgentMark kind="claude" />{t("Claude Code plugin")}</TabsTrigger>
                        <TabsTrigger value="codex-plugin" className="min-h-11"><AgentMark kind="codex" />{t("Codex plugin")}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="claude-plugin" className="flex flex-col gap-3">
                        <p className="m-0">{t("Run these commands in a Claude Code session:")}</p>
                        <CopyBlock value={'/plugin marketplace add signalco-io/uier\n/plugin install uier@uier'} label={t("Copy Claude Code plugin commands")} />
                        <p className="m-0 text-muted-foreground">{t("Run")}{' '}<code>/mcp</code> {t("and authenticate the plugin’s uier connection. Then use")}{' '}<code>/uier:uier-monitor &lt;project&gt;</code> {t("when you want it to monitor a project.")}</p>
                        <a className={cn(link, 'self-start')} href="https://code.claude.com/docs/en/plugins/publish#publish-through-your-own-marketplace" target="_blank" rel="noreferrer">{t("Claude Code plugin documentation")}</a>
                    </TabsContent>
                    <TabsContent value="codex-plugin" className="flex flex-col gap-3">
                        <p className="m-0">{t("Run these commands in your terminal:")}</p>
                        <CopyBlock value={"codex plugin marketplace add signalco-io/uier\ncodex plugin add uier@uier"} label={t("Copy Codex plugin commands")} />
                        <p className="m-0 text-muted-foreground">{t("Start a new session and follow the plugin’s sign-in flow. Ask Codex to use uier-monitor for your project. If your client cannot complete plugin sign-in, use the access-token setup under Connect a coding tool below.")}</p>
                        <a className={cn(link, 'self-start')} href="https://learn.chatgpt.com/docs/developer-commands#codex-plugin" target="_blank" rel="noreferrer">{t("Codex plugin documentation")}</a>
                    </TabsContent>
                </Tabs>
                <p className="m-0 text-muted-foreground">{t("The plugin connects to")}{' '}<code>https://uier.io/api/mcp</code>{t(". Installing it starts no monitor. Invoking uier-monitor approves its workflow for comments in scope, including fixes, merges and replies. Keep one uier connection enabled if you already added it manually.")}</p>
                <a className={cn(link, 'self-start')} href="https://github.com/signalco-io/uier/blob/main/docs/agent-plugins.md" target="_blank" rel="noreferrer">{t("Plugin setup and permissions")}</a>
            </div>
        </Section>
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
    const { t } = useAppI18n();
    const clients = mcpClientConfigurations(endpoint);
    return (
        <Section id="connect" title={t("Connect a coding tool")}
            description={t("A tool that signs in with your browser opens uier, where you choose the accounts, workspaces, projects and operations it can use. Each profile's current permissions apply.")}>
            <div className="flex flex-col gap-6 text-sm">
                <div className="flex flex-col gap-2">
                    <p className="m-0 text-muted-foreground">{t("Add this Streamable HTTP endpoint to your coding tool:")}</p>
                    <CopyBlock value={endpoint} label={t("Copy MCP endpoint")} />
                </div>
                <Tabs defaultValue={clients[0]!.id} className="gap-4">
                    <TabsList aria-label={t("Coding client")} variant="line" className="h-auto! max-w-full flex-wrap">
                        {clients.map(client => <TabsTrigger key={client.id} value={client.id} className="min-h-11">
                            <AgentMark kind={inferAgentKind(client.name)} />
                            {client.name}
                        </TabsTrigger>)}
                    </TabsList>
                    {clients.map(client => <TabsContent key={client.id} value={client.id} className="flex flex-col gap-4">
                        {client.auth === 'oauth'
                            ? <>
                                <ol className="m-0 flex list-none flex-col gap-4 p-0">
                                    <Step number={1} title={t("Add uier in your terminal")}>
                                        <CopyBlock value={client.command} label={t("Copy {value1} command", { value1: client.name })} />
                                    </Step>
                                    <Step number={2} title={<>{t("Run")}{' '}<code>/mcp</code> {t("in")}{' '}{client.name}{t(", choose uier and select Authenticate")}</>}>
                                        <p className="m-0 text-muted-foreground">{t("Your browser opens uier, where you approve the connection. It then shows up under Connected apps.")}</p>
                                    </Step>
                                </ol>
                                <p className="m-0 text-muted-foreground">{t("Already added uier with an")}{' '}<code>{t("Authorization")}</code> {t("header, for example in")}{' '}<code>{t(".mcp.json")}</code>{t("? Remove that header first.")}{' '}{client.name} {t("does not sign in while it is set.")}{' '}<a className={link} href={client.docs} target="_blank" rel="noreferrer">{client.name} {t("documentation")}</a></p>
                            </>
                            : <>
                                <ol className="m-0 flex list-none flex-col gap-4 p-0">
                                    <Step number={1} title={t("Create an access token")}>
                                        <p className="m-0 text-muted-foreground">{client.name} {t("uses an access token. Create one under")}{' '}<a className={link} href="#access-tokens">{t("Access tokens")}</a> {t("below.")}</p>
                                    </Step>
                                    <Step number={2} title={<>{t("Set")}{' '}<code>{t("UIER_MCP_TOKEN")}</code></>}>
                                        <p className="m-0 text-muted-foreground">{t("Set it in the environment that starts")}{' '}{client.name}.</p>
                                    </Step>
                                    <Step number={3} title={<>{t("Add uier to")}{' '}<code>{client.location}</code></>}>
                                        <p className="m-0 text-muted-foreground">{t("Merge the entry into your existing configuration.")}</p>
                                        <CopyBlock value={client.configuration} label={t("Copy {value1} MCP configuration", { value1: client.name })} />
                                    </Step>
                                </ol>
                                <p className="m-0 text-muted-foreground"><a className={link} href={client.docs} target="_blank" rel="noreferrer">{client.name} {t("documentation")}</a></p>
                            </>}
                    </TabsContent>)}
                </Tabs>
                <details className="rounded-lg border">
                    <summary className="cursor-pointer px-4 py-3 font-medium">{t("Other clients")}</summary>
                    <div className="flex flex-col gap-3 px-4 pb-4 text-muted-foreground">
                        <p className="m-0">{t("Claude on the web, desktop and mobile is not offered yet. Its custom connector has not been checked against uier’s sign-in. Request headers for custom connectors are in beta for a limited set of organizations. Where they are available on an individual plan, a custom connector can use the endpoint URL, No sign-in, and")}{' '}<code>{t("Authorization: Bearer <access token>")}</code> {t("under Request headers. Claude connects from Anthropic’s servers and cannot reach a local endpoint. Team and Enterprise plans would share your personal token, so do not use one there.")}{' '}<a className={link} href="https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers" target="_blank" rel="noreferrer">{t("Claude connector documentation")}</a></p>
                        <p className="m-0">{t("VS Code is not offered until a connection can be verified. Its")}{' '}<a className={link} href="https://code.visualstudio.com/docs/agents/reference/mcp-configuration" target="_blank" rel="noreferrer">{t("MCP documentation")}</a> {t("describes masked secret inputs.")}</p>
                        <p className="m-0">{t("Windsurf is not offered until a connection can be verified. Its")}{' '}<a className={link} href="https://docs.devin.ai/desktop/cascade/mcp" target="_blank" rel="noreferrer">{t("current documentation")}</a> {t("describes legacy Cascade in Devin Desktop.")}</p>
                    </div>
                </details>
                <p className="m-0 text-xs text-muted-foreground">{t("Feedback sent to a coding tool is handled under that tool’s terms.")}</p>
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
    const { t } = useAppI18n();
    const skill = feedbackSkill();
    return (
        <Section id="skill" title={t("Prompts and agent skill")} description={t("Prompts a connected coding tool can use, and a skill with the same workflow.")}>
            <div className="flex flex-col gap-4 text-sm">
                <ul aria-label={t("Prompts")} className="m-0 flex list-none flex-col divide-y rounded-lg border p-0">
                    {prompts.map(prompt => <li key={prompt.name} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
                        <code className="shrink-0 text-[13px] sm:w-36">{prompt.name}</code>
                        <span className="text-muted-foreground">{t(prompt.description)}</span>
                    </li>)}
                </ul>
                <p className="m-0">{t("Copy or download this skill and save it as")}{' '}<code>{t("uier-feedback/SKILL.md")}</code> {t("in your client’s skills folder. It uses the same workflow as the prompts.")}</p>
                <a download="SKILL.md" href={`data:text/markdown;charset=utf-8,${encodeURIComponent(skill)}`} className={cn(buttonVariants({ variant: 'outline' }), 'self-start')}>
                    <DownloadIcon data-icon="inline-start" />
                    {t("Download SKILL.md")}{' '}</a>
                <details>
                    <summary className="cursor-pointer font-medium">{t("View and copy SKILL.md")}</summary>
                    <div className="mt-3"><CopyBlock value={skill} label={t("Copy SKILL.md")} /></div>
                </details>
            </div>
        </Section>
    );
}
