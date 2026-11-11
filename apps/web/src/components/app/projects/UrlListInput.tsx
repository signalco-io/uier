'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { useId, useState, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { FieldDescription, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/src/components/ui/input-group';
import { cn } from '@/src/lib/utils';
import { MAX_PROJECT_URLS } from '../../../lib/app/limits';

/** A local address typed without a scheme, which `normalizeSiteUrl` opens over HTTP */
const schemelessLocal = /^(localhost|[^/:]+\.localhost|127(\.\d+){3}|\[::1\])\.?(:\d+)?(\/|$)/i;

/** One empty field after the last address, for the next one (up to the limit) */
function withNextField(rows: { key: number; url: string }[]) {
    let end = rows.length;
    while (end > 1 && !rows[end - 1]?.url.trim() && !rows[end - 2]?.url.trim())
        end--;
    const kept = rows.slice(0, end);
    return kept.at(-1)?.url.trim() && kept.length < MAX_PROJECT_URLS
        ? [...kept, { key: Math.max(...kept.map(row => row.key)) + 1, url: '' }]
        : kept;
}

/**
 * The site addresses of a project as `url` form fields: one list, the main site first, then any
 * others (staging, preview). Typing in the last field adds an empty one under it for the next
 * address. Empty fields are ignored when the form is saved. The fields are controlled, so React's
 * reset after a form action never drops what was typed. `onUrlsChange` gets the typed addresses
 * (the main site first) after every change.
 */
export function UrlListInput({ defaultUrls = [], description, hideLegend = false, onUrlsChange }: {
    defaultUrls?: string[];
    description?: ReactNode;
    /** When a heading around the list already says "Site addresses" (the legend stays for screen readers) */
    hideLegend?: boolean;
    onUrlsChange?: (urls: string[]) => void;
}) {
    const { t } = useAppI18n();
    const idPrefix = useId();
    const [rows, setRows] = useState(() => withNextField((defaultUrls.length ? defaultUrls : ['']).map((url, index) => ({ key: index, url }))));

    const update = (next: { key: number; url: string }[]) => {
        setRows(next);
        onUrlsChange?.(next.map(row => row.url));
    };
    const removeRow = (key: number) => update(withNextField(rows.filter(row => row.key !== key)));
    const setUrl = (key: number, url: string) => update(withNextField(rows.map(row => row.key === key ? { ...row, url } : row)));

    return (
        <FieldSet className="gap-3">
            <FieldLegend variant="label" className={cn('mb-0', hideLegend && 'sr-only')}>{t("Site addresses")}</FieldLegend>
            {description && <FieldDescription>{description}</FieldDescription>}
            <div className="flex flex-col gap-2">
                {rows.map((row, index) => (
                    // Every field is as wide as the first: the remove button sits inside the field
                    <InputGroup key={row.key}>
                        <InputGroupInput
                            id={`${idPrefix}-${row.key}`}
                            name="url"
                            aria-label={index === 0 ? t("Main site address") : t("Address {value0}", { value0: index + 1 })}
                            value={row.url}
                            onChange={(event) => setUrl(row.key, event.target.value)}
                            required={index === 0}
                            inputMode="url"
                            autoComplete="url"
                            spellCheck={false}
                            placeholder={index === 0 ? 'example.com' : t("staging.example.com (optional)")}
                            className="font-mono text-[13px] md:text-[13px]" />
                        {/* Not on the main site, nor on the empty field for the next address */}
                        {index > 0 && (row.url || index < rows.length - 1) && (
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    size="icon-xs"
                                    aria-label={t("Remove address {value0}", { value0: index + 1 })}
                                    onClick={() => removeRow(row.key)}>
                                    <XIcon />
                                </InputGroupButton>
                            </InputGroupAddon>
                        )}
                    </InputGroup>
                ))}
            </div>
            {/* Only once a local address is typed */}
            {rows.some(row => schemelessLocal.test(row.url.trim())) && (
                <FieldDescription>{t("Local addresses use HTTP by default. Include https:// for local HTTPS.")}</FieldDescription>
            )}
        </FieldSet>
    );
}
