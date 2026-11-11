'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDownIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { ItemGroup } from '@/src/components/ui/item';
import { Spinner } from '@/src/components/ui/spinner';
import { RelativeTime } from '../comments/DateTime';
import { CopyBlock } from '../CopyBlock';
import { FormMessage } from '../FormMessage';
import { Section } from '../PageHeader';
import { createMcpCredentialAction, revokeMcpCredentialAction } from '@/src/lib/mcp/actions';
import { ConnectionAvatar, ConnectionItem, ConnectionReach, ScopeBadges } from './ConnectionSummary';
import { scopeOptions } from './scopes';

export type AccessToken = {
    id: string; name: string; projectIds: string[]; scopes: string[]; expiresAt: string;
    createdBy?: { name: string };
    actingAccount?: string;
    projectNames?: string[];
};

/**
 * Hand-made and connection-created credentials: one workspace, chosen projects, up to 30 days.
 * Secrets from this form are shown once. Collapsed by default under Coding agents.
 */
export function AccessTokens({ projects, credentials }: { projects: { id: string; name: string }[]; credentials: AccessToken[] }) {
    const { t } = useAppI18n();
    const [open, setOpen] = useState(false);
    // Kept here, so a token that was just created stays on screen when the card is closed and opened again
    const form = useCreateTokenForm();
    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <Section id="access-tokens" title={t("Access tokens")}
                description={<>{t("For environments without a browser, such as SSH sessions, containers and CI. A token works with the Codex and Cursor setups above. You have")}{' '}{credentials.length === 0 ? t("no tokens") : credentials.length === 1 ? t("one token") : t("{value1} tokens", { value1: credentials.length })}.</>}>
                <div className="flex flex-col gap-6">
                    <CollapsibleTrigger render={<Button variant="outline" className="group self-start" />}>
                        {open ? t("Hide access tokens") : t("Show access tokens")}
                        <ChevronDownIcon data-icon="inline-end" className="transition-transform group-aria-expanded:rotate-180" />
                    </CollapsibleTrigger>
                    {open && <CollapsibleContent className="flex flex-col gap-6">
                        <CreateToken projects={projects} form={form} />
                        {credentials.length > 0 && <ItemGroup aria-label={t("Your access tokens")} className="gap-3">
                            {credentials.map(credential => <AccessTokenRow key={credential.id} credential={credential} projects={projects} />)}
                        </ItemGroup>}
                    </CollapsibleContent>}
                </div>
            </Section>
        </Collapsible>
    );
}

function useCreateTokenForm() {
    const [state, action, pending] = useActionState(createMcpCredentialAction, null);
    const [name, setName] = useState('');
    const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
    const [selectedScopes, setSelectedScopes] = useState<string[]>(['feedback:read']);
    const [hiddenToken, setHiddenToken] = useState<string>();
    return { state, action, pending, name, setName, selectedProjects, setSelectedProjects, selectedScopes, setSelectedScopes, hiddenToken, setHiddenToken };
}

function CreateToken({ projects, form }: { projects: { id: string; name: string }[]; form: ReturnType<typeof useCreateTokenForm> }) {
    const { t } = useAppI18n();
    const { state, action, pending, name, setName, selectedProjects, setSelectedProjects, selectedScopes, setSelectedScopes, hiddenToken, setHiddenToken } = form;
    const token = state?.ok ? state.data.token : undefined;
    return (
        <>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                <p className="m-0">{t("Tokens expire within 30 days. Revoke them here at any time. Your current project permissions still apply.")}</p>
                <p className="m-0">{t("Each token is limited to selected projects in the current workspace. For feedback about uier itself, switch to the uier workspace and select uier.io public feedback. The project page you were viewing does not own that feedback.")}</p>
            </div>
            <form action={action} className="flex flex-col gap-5 rounded-lg border p-4">
                <FieldGroup className="gap-5">
                    <Field>
                        <FieldLabel htmlFor="token-label">{t("Token label")}</FieldLabel>
                        <Input id="token-label" name="name" value={name} onChange={event => setName(event.target.value)} required maxLength={60}
                            placeholder={t("My coding tool")} autoComplete="off" />
                    </Field>
                    <FieldSet className="gap-3">
                        <FieldLegend variant="label">{t("Projects in this workspace")}</FieldLegend>
                        {projects.map(project => <Field key={project.id} orientation="horizontal">
                            <Checkbox id={`token-project-${project.id}`} checked={selectedProjects.includes(project.id)}
                                onCheckedChange={checked => setSelectedProjects(previous => checked === true ? [...previous, project.id] : previous.filter(id => id !== project.id))} />
                            <FieldLabel htmlFor={`token-project-${project.id}`} className="font-normal break-words">{project.name}</FieldLabel>
                        </Field>)}
                        {!projects.length && <FieldDescription>{t("Create a project before connecting a coding tool.")}</FieldDescription>}
                    </FieldSet>
                    <FieldSet className="gap-3">
                        <FieldLegend variant="label">{t("Allowed operations")}</FieldLegend>
                        {scopeOptions.map(({ scope, label, description }) => <Field key={scope} orientation="horizontal">
                            <Checkbox id={`token-scope-${scope}`} checked={selectedScopes.includes(scope)} aria-describedby={`token-scope-${scope}-description`}
                                onCheckedChange={checked => setSelectedScopes(previous => checked === true ? [...previous, scope] : previous.filter(value => value !== scope))} />
                            <FieldContent>
                                <FieldLabel htmlFor={`token-scope-${scope}`}>{label}</FieldLabel>
                                <FieldDescription id={`token-scope-${scope}-description`}>{description}</FieldDescription>
                            </FieldContent>
                        </Field>)}
                    </FieldSet>
                </FieldGroup>
                {selectedProjects.map(id => <input key={id} type="hidden" name="projectIds" value={id} />)}
                {selectedScopes.map(scope => <input key={scope} type="hidden" name="scopes" value={scope} />)}
                <FormMessage state={state} />
                <Button type="submit" disabled={pending || !projects.length} className="self-start">
                    {pending && <Spinner data-icon="inline-start" />}
                    {pending ? t("Creating…") : t("Create token")}
                </Button>
            </form>
            {token && token !== hiddenToken && <div className="flex flex-col gap-3 rounded-lg border p-4" role="status">
                <p className="m-0 text-sm">{t("Copy this token now. It will not be shown again after you leave this page. Keep it in your client’s environment as")}{' '}<code>{t("UIER_MCP_TOKEN")}</code>{t(", outside source control.")}</p>
                <CopyBlock value={token} label={t("Copy access token")} />
                <Button variant="outline" onClick={() => setHiddenToken(token)} className="self-start">{t("Hide token")}</Button>
            </div>}
        </>
    );
}

function AccessTokenRow({ credential, projects }: { credential: AccessToken; projects: { id: string; name: string }[] }) {
    const { t } = useAppI18n();
    return (
        <ConnectionItem avatar={<ConnectionAvatar hints={[credential.name]} />} title={credential.name}
            description={(credential.createdBy || credential.actingAccount) && <>
                {credential.createdBy && <span>{t("Created by")}{' '}{credential.createdBy.name}</span>}
                {credential.actingAccount && <span>{t("Acts as")}{' '}<span className="break-all">{credential.actingAccount}</span></span>}
            </>}
            actions={<form action={revokeMcpCredentialAction.bind(null, credential.id)}><RevokeToken name={credential.name} /></form>}>
            <ConnectionReach>
                <span className="sr-only">{t("Projects:")}{' '}</span>
                {(credential.projectNames ?? credential.projectIds.map(id => projects.find(project => project.id === id)?.name ?? id)).join(', ')}
            </ConnectionReach>
            <ScopeBadges scopes={credential.scopes} />
            <p className="m-0 text-xs text-muted-foreground">{t("Expires")}{' '}<RelativeTime value={credential.expiresAt} /></p>
        </ConnectionItem>
    );
}

function RevokeToken({ name }: { name: string }) {
    const { t } = useAppI18n();
    const { pending } = useFormStatus();
    return (
        <Button type="submit" variant="ghost" size="sm" disabled={pending} aria-label={t("Revoke {name}", { name: name })}>
            {pending && <Spinner data-icon="inline-start" />}
            {t("Revoke")}{' '}</Button>
    );
}
