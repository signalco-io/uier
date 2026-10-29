'use client';

import { useActionState, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { Checkbox } from '@signalco/ui-primitives/Checkbox';
import { Button as AppButton } from '@/src/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { CopyBlock } from '../CopyBlock';
import { FormMessage } from '../FormMessage';
import { createMcpCredentialAction, revokeMcpCredentialAction } from '@/src/lib/mcp/actions';
import { scopeLabel, scopeOptions } from './scopes';

export type AccessToken = { id: string; name: string; projectIds: string[]; scopes: string[]; expiresAt: string };

/**
 * Manually created credentials for environments without a browser (SSH, containers, CI): one
 * workspace, chosen projects, 30 days, shown once. Collapsed by default under Coding agents.
 */
export function AccessTokens({ projects, credentials }: { projects: { id: string; name: string }[]; credentials: AccessToken[] }) {
    const [open, setOpen] = useState(false);
    const [state, action, pending] = useActionState(createMcpCredentialAction, null);
    const [name, setName] = useState('');
    const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
    const [selectedScopes, setSelectedScopes] = useState<string[]>(['feedback:read']);
    const [hiddenToken, setHiddenToken] = useState<string>();
    const token = state?.ok ? state.data.token : undefined;
    return (
        <Collapsible open={open} onOpenChange={setOpen} asChild>
            <section aria-labelledby="access-tokens-title" className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <h3 id="access-tokens-title" className="m-0 text-sm font-semibold">Access tokens</h3>
                        <p className="m-0 text-sm text-muted-foreground">For environments without a browser, such as SSH sessions, containers and CI. A token works with Codex and Cursor setups above. You have {credentials.length === 0 ? 'no tokens' : credentials.length === 1 ? 'one token' : `${credentials.length} tokens`}.</p>
                    </div>
                    <CollapsibleTrigger asChild>
                        <AppButton variant="outline" className="group">
                            {open ? 'Hide access tokens' : 'Show access tokens'}
                            <ChevronDownIcon data-icon="inline-end" className="transition-transform group-aria-expanded:rotate-180" />
                        </AppButton>
                    </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="flex flex-col gap-5">
                    <p className="m-0 text-sm text-muted-foreground">Tokens expire after 30 days. Revoke them here at any time. Your current project permissions still apply.</p>
                    <p className="m-0 text-sm text-muted-foreground">Each token is limited to selected projects in the current workspace. For feedback about uier itself, switch to the uier workspace and select uier.io public feedback. The project page you were viewing does not own that feedback.</p>
                    <form action={action} className="flex flex-col gap-4">
                        <Input name="name" label="Token label" value={name} onChange={event => setName(event.target.value)} required maxLength={60} placeholder="My coding tool" />
                        <fieldset className="flex flex-col gap-2">
                            <legend className="mb-2 text-sm font-medium">Projects in this workspace</legend>
                            {projects.map(project => <Checkbox key={project.id} name="projectIds" value={project.id} label={<span className="flex min-h-11 items-center">{project.name}</span>} checked={selectedProjects.includes(project.id)} onCheckedChange={checked => setSelectedProjects(previous => checked ? [...previous, project.id] : previous.filter(id => id !== project.id))} />)}
                            {!projects.length && <p className="text-sm text-muted-foreground">Create a project before connecting a coding tool.</p>}
                        </fieldset>
                        <fieldset className="flex flex-col gap-2">
                            <legend className="mb-2 text-sm font-medium">Allowed operations</legend>
                            {scopeOptions.map(({ scope, label }) => <Checkbox key={scope} name="scopes" value={scope} label={<span className="flex min-h-11 items-center">{label}</span>} checked={selectedScopes.includes(scope)} onCheckedChange={checked => setSelectedScopes(previous => checked ? [...previous, scope] : previous.filter(value => value !== scope))} />)}
                        </fieldset>
                        <FormMessage state={state} />
                        <Button type="submit" disabled={pending || !projects.length} className="self-start">{pending ? 'Creating…' : 'Create token'}</Button>
                    </form>
                    {token && token !== hiddenToken && <div className="flex flex-col gap-3 rounded-xl border p-4" role="status">
                        <p className="text-sm">Copy this token now. It will not be shown again after you leave this page. Keep it in your client’s environment as <code>UIER_MCP_TOKEN</code>, outside source control.</p>
                        <CopyBlock value={token} label="Copy access token" />
                        <Button variant="outlined" onClick={() => setHiddenToken(token)} className="self-start">Hide token</Button>
                    </div>}
                    {credentials.length > 0 && <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-label="Your access tokens">
                        {credentials.map(credential => <li key={credential.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
                            <div className="min-w-0 text-sm">
                                <p className="font-medium break-words">{credential.name}</p>
                                <p className="break-words text-muted-foreground">Projects: {credential.projectIds.map(id => projects.find(project => project.id === id)?.name ?? id).join(', ')}</p>
                                <p className="break-words text-muted-foreground">{credential.scopes.map(scopeLabel).join(', ')}</p>
                                <p className="text-muted-foreground">Expires {credential.expiresAt.slice(0, 10)}</p>
                            </div>
                            <form action={revokeMcpCredentialAction.bind(null, credential.id)}><Button type="submit" variant="outlined" aria-label={`Revoke ${credential.name}`}>Revoke</Button></form>
                        </li>)}
                    </ul>}
                </CollapsibleContent>
            </section>
        </Collapsible>
    );
}
