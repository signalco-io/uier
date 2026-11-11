'use client';
import { useAppI18n } from '@/src/lib/i18n/client';


import { useActionState, useId } from 'react';
import { flushSync } from 'react-dom';
import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { FieldDescription } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Section } from '../PageHeader';
import { SaveFooter, useSettingsDraft } from '../SettingsSave';
import { MAX_PROJECT_URLS } from '../../../lib/app/limits';
import type { ProjectEnvironment } from '../../../lib/app/environments';
import { displayUrl } from './projectLabels';
import { hasSchemelessLocal, sameSiteAs, savedSiteRows, shareOptions, sharedWith, shareWith, siteRowsPayload, type SiteRow } from './siteRows';
import { updateProjectSitesAction } from './actions';
import { keepValues } from './keepFormValues';

/** The columns of the site addresses table: address, label, shared with, remove */
const siteColumns = '@xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.25fr)_2.25rem]';

/**
 * Environments: the site addresses as one table. Each address has a label and the other addresses
 * it shares feedback with; addresses on one origin are one site and share both. One save.
 */
export function ProjectSitesForm({ projectId, urls, environments }: { projectId: string; urls: string[]; environments: ProjectEnvironment[] }) {
    const { t } = useAppI18n();
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateProjectSitesAction, null);
    const { draft: rows, dirty, update, discard } = useSettingsDraft(savedSiteRows(urls, environments), state);
    const setRow = (index: number, change: Partial<SiteRow>) => update(current => current.map((row, i) => i === index ? { ...row, ...change } : row));
    const name = (row: SiteRow, index: number) => row.url.trim() ? displayUrl(row.url.trim()) : `address ${index + 1}`;

    const addRow = () => {
        // The new row is rendered at once, so focus can move into its address field
        flushSync(() => update(current => [...current, { url: '', label: '', group: null }]));
        const fields = document.getElementById(formId)?.querySelectorAll<HTMLInputElement>('input[inputmode="url"]');
        fields?.[fields.length - 1]?.focus();
    };
    const removeRow = (index: number) => update(current => shareWith(current, index, null).filter((_, i) => i !== index));

    return (
        <Section
            id="addresses"
            title={t("Site addresses")}
            description={t("The toolbar works only on these addresses, the main site first. Each site keeps its own feedback unless it shares it.")}
            stickyFooter
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <form id={formId} action={formAction} onResetCapture={keepValues} className="flex flex-col gap-4">
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="sites" value={JSON.stringify(siteRowsPayload(rows, environments))} />
                {/* A table where the card is wide enough, otherwise a card per address */}
                <div className="@container flex flex-col gap-3">
                    <div aria-hidden="true" className={`hidden gap-2 text-sm font-medium @xl:grid ${siteColumns}`}>
                        <span>{t("Address")}</span>
                        <span>{t("Label")}</span>
                        <span>{t("Shares feedback with")}</span>
                    </div>
                    {rows.map((row, index) => {
                        const sameSite = sameSiteAs(rows, index);
                        const options = shareOptions(rows, index);
                        const shared = sharedWith(rows, index);
                        // From the rows, not the Select's value: right after a row is removed that value can still be an old index
                        const sharedLabel = shared[0] === undefined
                            ? t("No other address")
                            : `${displayUrl(rows[shared[0]]!.url.trim())}${shared.length > 1 ? t(" and {value0} more", { value0: shared.length - 1 }) : ''}`;
                        return (
                            // Stacked on small screens, with the column names over the fields
                            <div key={index} className={`grid grid-cols-[minmax(0,1fr)_2.25rem] gap-x-2 gap-y-3 rounded-lg border p-3 @xl:items-center @xl:gap-y-0 @xl:rounded-none @xl:border-0 @xl:p-0 ${siteColumns}`}>
                                <div className="flex min-w-0 flex-col gap-1.5">
                                    <label htmlFor={`${formId}-url-${index}`} aria-hidden="true" className="text-xs text-muted-foreground @xl:hidden">{t("Address")}</label>
                                    <Input
                                        id={`${formId}-url-${index}`}
                                        aria-label={index === 0 ? t("Main site address") : t("Address {value0}", { value0: index + 1 })}
                                        value={row.url}
                                        onChange={event => setRow(index, { url: event.target.value })}
                                        required={index === 0}
                                        inputMode="url"
                                        autoComplete="url"
                                        spellCheck={false}
                                        placeholder={index === 0 ? 'example.com' : 'staging.example.com'}
                                        className="font-mono text-[13px] md:text-[13px]" />
                                </div>
                                <div className="col-start-2 row-start-1 self-end @xl:col-start-4">
                                    {index > 0
                                        ? <Button variant="ghost" size="icon" aria-label={t("Remove address {value0}", { value0: index + 1 })} onClick={() => removeRow(index)}><XIcon /></Button>
                                        : <span aria-hidden="true" className="block size-9" />}
                                </div>
                                {sameSite >= 0 ? (
                                    <p className="col-span-2 m-0 text-sm text-muted-foreground @xl:col-span-2 @xl:col-start-2 @xl:row-start-1">{t("Same site as")}{' '}{displayUrl(rows[sameSite]!.url.trim())}{t(", with its label and feedback.")}</p>
                                ) : (
                                    <>
                                        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 @xl:col-span-1 @xl:col-start-2 @xl:row-start-1">
                                            <label htmlFor={`${formId}-label-${index}`} aria-hidden="true" className="text-xs text-muted-foreground @xl:hidden">{t("Label")}</label>
                                            <Input
                                                id={`${formId}-label-${index}`}
                                                aria-label={t("Label for {value0}", { value0: name(row, index) })}
                                                value={t(row.label)}
                                                maxLength={60}
                                                onChange={event => setRow(index, { label: event.target.value })}
                                                placeholder={index === 0 ? 'Production' : 'Staging'} />
                                        </div>
                                        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 @xl:col-span-1 @xl:col-start-3 @xl:row-start-1">
                                            <label htmlFor={`${formId}-share-${index}`} aria-hidden="true" className="text-xs text-muted-foreground @xl:hidden">{t("Shares feedback with")}</label>
                                            <Select
                                                value={shared[0] === undefined ? 'none' : String(shared[0])}
                                                onValueChange={value => update(current => shareWith(current, index, value && value !== 'none' ? Number(value) : null))}
                                                disabled={options.length === 0}>
                                                <SelectTrigger id={`${formId}-share-${index}`} aria-label={t("{value0} shares feedback with", { value0: name(row, index) })} className="w-full">
                                                    <SelectValue>{sharedLabel}</SelectValue>
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        <SelectItem value="none">{t("No other address")}</SelectItem>
                                                        {options.map(({ row: option, other }) => (
                                                            <SelectItem key={other} value={String(other)}>{displayUrl(option.url.trim())}</SelectItem>
                                                        ))}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
                {rows.length < MAX_PROJECT_URLS && (
                    <Button variant="outline" size="sm" className="self-start" onClick={addRow}>
                        <PlusIcon data-icon="inline-start" />{t("Add address")}</Button>
                )}
                <div className="flex flex-col gap-1">
                    {hasSchemelessLocal(rows) && <FieldDescription>{t("Local addresses use HTTP by default. Include https:// for local HTTPS.")}</FieldDescription>}
                    <FieldDescription>{t("Share feedback only between copies of one site, such as example.com and www.example.com: their comments show on the same pages. Removing an address keeps its comments.")}</FieldDescription>
                </div>
            </form>
        </Section>
    );
}
