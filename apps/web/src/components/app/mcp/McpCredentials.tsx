'use client';

import { useActionState, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { Checkbox } from '@signalco/ui-primitives/Checkbox';
import { Section } from '../PageHeader';
import { CopyBlock } from '../CopyBlock';
import { FormMessage } from '../FormMessage';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/components/ui/tabs';
import { Button as AppButton } from '@/src/components/ui/button';
import { mcpClientConfigurations } from '@/src/lib/mcp/clients';
import { feedbackSkill } from '@/src/lib/mcp/workflows';
import { createMcpCredentialAction, revokeMcpCredentialAction } from '@/src/lib/mcp/actions';

const scopeLabels = [
    ['feedback:read', 'Read feedback'], ['screenshots:read', 'Read screenshots'],
    ['feedback:reply', 'Reply to feedback'], ['feedback:status', 'Change status'], ['feedback:assign', 'Assign feedback']
] as const;

type Credential = { id: string; name: string; projectIds: string[]; scopes: string[]; expiresAt: string };
export function McpCredentials({ projects, credentials, endpoint }: {
    projects: { id: string; name: string }[]; credentials: Credential[]; endpoint: string;
}) {
    const [state, action, pending] = useActionState(createMcpCredentialAction, null);
    const [name, setName] = useState('');
    const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
    const [selectedScopes, setSelectedScopes] = useState<string[]>(['feedback:read']);
    const [hiddenToken, setHiddenToken] = useState<string>();
    const token = state?.ok ? state.data.token : undefined;
    const clients = mcpClientConfigurations(endpoint);
    const skill = feedbackSkill();
    return <Section id="mcp" title="Coding agents" description="Connect a coding tool to feedback as your account. Choose exactly what it may access.">
        <div className="flex flex-col gap-5">
            <p className="text-sm text-muted-foreground">Credentials expire after 30 days. Revoke them here at any time. Your current project permissions still apply. Feedback sent to your chosen client is handled under that client’s terms.</p>
            <form action={action} className="flex flex-col gap-4">
                <Input name="name" label="Credential label" value={name} onChange={event => setName(event.target.value)} required maxLength={60} placeholder="My coding tool" />
                <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">Projects in this workspace</legend>
                    {projects.map(project => <Checkbox key={project.id} name="projectIds" value={project.id} label={<span className="flex min-h-11 items-center">{project.name}</span>} checked={selectedProjects.includes(project.id)} onCheckedChange={checked => setSelectedProjects(previous => checked ? [...previous, project.id] : previous.filter(id => id !== project.id))} />)}
                    {!projects.length && <p className="text-sm text-muted-foreground">Create a project before connecting a coding tool.</p>}
                </fieldset>
                <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-sm font-medium">Allowed operations</legend>
                    {scopeLabels.map(([scope, label]) => <Checkbox key={scope} name="scopes" value={scope} label={<span className="flex min-h-11 items-center">{label}</span>} checked={selectedScopes.includes(scope)} onCheckedChange={checked => setSelectedScopes(previous => checked ? [...previous, scope] : previous.filter(value => value !== scope))} />)}
                </fieldset>
                <FormMessage state={state} />
                <Button type="submit" disabled={pending || !projects.length} className="self-start">{pending ? 'Creating…' : 'Create credential'}</Button>
            </form>
            {token && token !== hiddenToken && <div className="flex flex-col gap-3 rounded-xl border p-4" role="status">
                <p className="text-sm">Copy this credential now. It will not be shown again after you leave this page. Keep it in your client’s environment, outside source control.</p>
                <CopyBlock value={token} label="Copy MCP credential" />
                <Button variant="outlined" onClick={() => setHiddenToken(token)} className="self-start">Hide credential</Button>
            </div>}
            <details className="text-sm">
                <summary className="cursor-pointer font-medium">Client configuration</summary>
                <div className="mt-3 flex flex-col gap-2">
                <p>In your client, use this Streamable HTTP endpoint with the credential in the Authorization bearer header. OAuth login is not supported.</p>
                <CopyBlock value={endpoint} label="Copy MCP endpoint" />
                <p>Set <code>UIER_MCP_TOKEN</code> in the environment that starts your client. Merge the selected entry into your existing configuration.</p>
                <Tabs defaultValue="codex">
                    <TabsList aria-label="Coding client" variant="line" className="flex-wrap max-w-full h-auto!">
                        {clients.map(client => <TabsTrigger key={client.id} value={client.id} className="min-h-11">{client.name}</TabsTrigger>)}
                    </TabsList>
                    {clients.map(client => <TabsContent key={client.id} value={client.id} className="flex flex-col gap-3">
                        <p>Add to <code>{client.location}</code>. <a className="underline underline-offset-4" href={client.docs} target="_blank" rel="noreferrer">{client.name} documentation</a></p>
                        <CopyBlock value={client.configuration} label={`Copy ${client.name} MCP configuration`} />
                    </TabsContent>)}
                </Tabs>
                <details>
                    <summary className="cursor-pointer font-medium">Other clients</summary>
                    <div className="mt-3 flex flex-col gap-3">
                        <p>Claude Desktop is not supported without Request headers. Header authentication is in beta for a limited set of organizations. Team and Enterprise plans are not supported: an Owner adds custom connectors for the whole organization, which would share your personal credential. OAuth is needed for individual access.</p>
                        <p>Where available on an individual plan, the custom connector uses the endpoint URL, No sign-in, and <code>Authorization: Bearer &lt;credential&gt;</code> under Request headers. Claude connects from Anthropic’s servers and cannot reach a local endpoint. Remove and add the connector again after expiry or revocation. This setup has not been verified here, so it is not offered in the picker. <a className="underline underline-offset-4" href="https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers" target="_blank" rel="noreferrer">Claude connector documentation</a></p>
                        <p>VS Code is not offered until a connection can be verified. Its <a className="underline underline-offset-4" href="https://code.visualstudio.com/docs/agents/reference/mcp-configuration" target="_blank" rel="noreferrer">MCP documentation</a> describes masked secret inputs.</p>
                        <p>Windsurf is not offered until a connection can be verified. Its <a className="underline underline-offset-4" href="https://docs.devin.ai/desktop/cascade/mcp" target="_blank" rel="noreferrer">current documentation</a> describes legacy Cascade in Devin Desktop.</p>
                    </div>
                </details>
                </div>
            </details>
            <details className="text-sm">
                <summary className="cursor-pointer font-medium">Prompts and agent skill</summary>
                <div className="mt-3 flex flex-col gap-3">
                    <p>Choose <code>triage-feedback</code> to group open threads, or <code>fix-feedback</code> to propose a code change in your client. Both leave uier unchanged. <code>report-back</code> drafts a reply or status change and waits for your approval before every write. It is available only with reply or status access.</p>
                    <p>Copy or download this skill and save it as <code>uier-feedback/SKILL.md</code> in your client’s skills folder. It uses the same workflow as the prompts.</p>
                    <AppButton asChild variant="outline" className="self-start"><a download="SKILL.md" href={`data:text/markdown;charset=utf-8,${encodeURIComponent(skill)}`}>Download SKILL.md</a></AppButton>
                    <details>
                        <summary className="cursor-pointer font-medium">View and copy SKILL.md</summary>
                        <div className="mt-3"><CopyBlock value={skill} label="Copy SKILL.md" /></div>
                    </details>
                </div>
            </details>
            <ul className="flex flex-col gap-3" aria-label="MCP credentials">
                {credentials.map(credential => <li key={credential.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                    <div className="min-w-0 text-sm">
                        <p className="font-medium break-words">{credential.name}</p>
                        <p className="break-words text-muted-foreground">Projects: {credential.projectIds.map(id => projects.find(project => project.id === id)?.name ?? id).join(', ')}</p>
                        <p className="break-words text-muted-foreground">{credential.scopes.map(scope => scopeLabels.find(([value]) => value === scope)?.[1] ?? scope).join(', ')}</p>
                        <p className="text-muted-foreground">Expires {credential.expiresAt.slice(0, 10)}</p>
                    </div>
                    <form action={revokeMcpCredentialAction.bind(null, credential.id)}><Button type="submit" variant="outlined" aria-label={`Revoke ${credential.name}`}>Revoke</Button></form>
                </li>)}
            </ul>
        </div>
    </Section>;
}
