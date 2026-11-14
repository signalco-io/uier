'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useId, useRef } from 'react';
import { flushSync } from 'react-dom';
import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { MAX_PROJECT_LINK_LABEL_LENGTH, MAX_PROJECT_LINKS } from '@/src/lib/app/limits';
import { normalizeProjectLinkUrl, projectLinkName, projectLinkProvider, type ProjectLink } from '@/src/lib/app/projectLinks';
import { ProjectLinkIcon } from './ProjectLinkIcon';

/** The columns where the card is wide enough: icon, address, label, remove */
const linkColumns = '@xl:grid-cols-[1rem_minmax(0,1.5fr)_minmax(0,1fr)_2.25rem]';

/** The links General saves: rows with nothing typed are left out */
export const projectLinksPayload = (links: ProjectLink[]) => links.filter(link => link.url.trim() || link.label.trim());

/**
 * Links to the project's other tools (uier #434), part of General's single draft and save: one row per link with its
 * address and an optional label, the icon of the service its address belongs to beside it.
 */
export function ProjectLinksFields({ links, onChange, disabled }: {
    links: ProjectLink[];
    onChange: (change: (links: ProjectLink[]) => ProjectLink[]) => void;
    disabled: boolean;
}) {
    const { t } = useAppI18n();
    const id = useId();
    const list = useRef<HTMLDivElement>(null);
    const addButton = useRef<HTMLButtonElement>(null);
    const setLink = (index: number, change: Partial<ProjectLink>) => onChange(current => current.map((link, i) => i === index ? { ...link, ...change } : link));
    // What the row shows once saved, so the label's placeholder says what an empty label shows
    const name = (link: ProjectLink) => {
        const url = normalizeProjectLinkUrl(link.url);
        return url ? projectLinkName({ label: '', url }) : undefined;
    };

    const addLink = () => {
        // The new row is rendered at once, so focus can move into its address field
        flushSync(() => onChange(current => [...current, { label: '', url: '' }]));
        const fields = list.current?.querySelectorAll<HTMLInputElement>('input[inputmode="url"]');
        fields?.[fields.length - 1]?.focus();
    };
    const removeLink = (index: number) => {
        flushSync(() => onChange(current => current.filter((_, i) => i !== index)));
        // The focus stays in the list: on the row that took this one's place, else the one before, else Add link
        const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button[data-remove-link]');
        (buttons?.[Math.min(index, buttons.length - 1)] ?? addButton.current)?.focus();
    };

    return (
        <FieldSet disabled={disabled}>
            <FieldLegend variant="label">{t("Links")}</FieldLegend>
            <FieldDescription>{t("Shown under the project's name to everyone in the project. Links to GitHub, GitLab, Azure DevOps, Linear, Slack, Discord, Notion, Figma and Google Drive show their icon.")}</FieldDescription>
            {links.length > 0 && (
                // A table where the card is wide enough, otherwise a card per link
                <div ref={list} className="@container flex flex-col gap-3">
                    <div aria-hidden="true" className={`hidden gap-2 text-sm font-medium @xl:grid ${linkColumns}`}>
                        <span />
                        <span>{t("Address")}</span>
                        <span>{t("Label (optional)")}</span>
                    </div>
                    {links.map((link, index) => {
                        const url = normalizeProjectLinkUrl(link.url);
                        const shown = name(link);
                        const rowName = link.label.trim() || shown;
                        return (
                            // Stacked on small screens, with the column names over the fields
                            <div key={index} data-project-link-row
                                className={`grid grid-cols-[1rem_minmax(0,1fr)_2.25rem] items-center gap-x-2 gap-y-3 rounded-lg border p-3 @xl:gap-y-0 @xl:rounded-none @xl:border-0 @xl:p-0 ${linkColumns}`}>
                                <ProjectLinkIcon provider={url ? projectLinkProvider(url) : undefined} className="mb-2.5 self-end @xl:mb-0 @xl:self-center" />
                                <div className="flex min-w-0 flex-col gap-1.5">
                                    <label htmlFor={`${id}-url-${index}`} aria-hidden="true" className="text-xs text-muted-foreground @xl:hidden">{t("Address")}</label>
                                    <Input
                                        id={`${id}-url-${index}`}
                                        aria-label={t("Link {number} address", { number: index + 1 })}
                                        value={link.url}
                                        onChange={event => setLink(index, { url: event.target.value })}
                                        // Not a native url input: it takes addresses without https://
                                        inputMode="url"
                                        autoComplete="url"
                                        spellCheck={false}
                                        placeholder="github.com/acme/site"
                                        className="font-mono text-[13px] md:text-[13px]" />
                                </div>
                                <div className="col-start-3 row-start-1 self-end @xl:col-start-4">
                                    <Button variant="ghost" size="icon" data-remove-link aria-label={rowName ? t("Remove link {name}", { name: rowName }) : t("Remove link {number}", { number: index + 1 })} onClick={() => removeLink(index)}>
                                        <XIcon />
                                    </Button>
                                </div>
                                <div className="col-span-2 col-start-2 flex min-w-0 flex-col gap-1.5 @xl:col-span-1 @xl:col-start-3 @xl:row-start-1">
                                    <label htmlFor={`${id}-label-${index}`} aria-hidden="true" className="text-xs text-muted-foreground @xl:hidden">{t("Label (optional)")}</label>
                                    <Input
                                        id={`${id}-label-${index}`}
                                        aria-label={t("Link {number} label", { number: index + 1 })}
                                        value={link.label}
                                        maxLength={MAX_PROJECT_LINK_LABEL_LENGTH}
                                        onChange={event => setLink(index, { label: event.target.value })}
                                        // What an empty label shows: the service or the address's host
                                        placeholder={shown} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            {links.length < MAX_PROJECT_LINKS && (
                <Button ref={addButton} variant="outline" size="sm" className="self-start" onClick={addLink}>
                    <PlusIcon data-icon="inline-start" />{t("Add link")}</Button>
            )}
        </FieldSet>
    );
}
