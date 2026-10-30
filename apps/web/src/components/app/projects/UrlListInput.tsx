'use client';

import { useId, useState, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
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
 * reset after a form action never drops what was typed.
 */
export function UrlListInput({ defaultUrls = [], description, hideLegend = false }: {
    defaultUrls?: string[];
    description?: ReactNode;
    /** When a heading around the list already says "Site addresses" (the legend stays for screen readers) */
    hideLegend?: boolean;
}) {
    const idPrefix = useId();
    const [rows, setRows] = useState(() => withNextField((defaultUrls.length ? defaultUrls : ['']).map((url, index) => ({ key: index, url }))));

    const removeRow = (key: number) => setRows(current => withNextField(current.filter(row => row.key !== key)));
    const setUrl = (key: number, url: string) => setRows(current => withNextField(current.map(row => row.key === key ? { ...row, url } : row)));

    return (
        <FieldSet className="gap-3">
            <FieldLegend variant="label" className={cn('mb-0', hideLegend && 'sr-only')}>Site addresses</FieldLegend>
            {description && <FieldDescription>{description}</FieldDescription>}
            <div className="flex flex-col gap-2">
                {rows.map((row, index) => (
                    <div key={row.key} className="flex items-center gap-2">
                        <Input
                            id={`${idPrefix}-${row.key}`}
                            name="url"
                            aria-label={index === 0 ? 'Main site address' : `Address ${index + 1}`}
                            value={row.url}
                            onChange={(event) => setUrl(row.key, event.target.value)}
                            required={index === 0}
                            inputMode="url"
                            autoComplete="url"
                            spellCheck={false}
                            placeholder={index === 0 ? 'example.com' : 'staging.example.com (optional)'}
                            className="font-mono text-[13px] md:text-[13px]" />
                        {index > 0 && (row.url || index < rows.length - 1 ? (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove address ${index + 1}`}
                                onClick={() => removeRow(row.key)}>
                                <XIcon />
                            </Button>
                        ) : (
                            // The empty field for the next address lines up with the ones that have a remove button
                            <span aria-hidden="true" className="size-9 shrink-0" />
                        ))}
                    </div>
                ))}
            </div>
            {/* Only once a local address is typed */}
            {rows.some(row => schemelessLocal.test(row.url.trim())) && (
                <FieldDescription>Local addresses use HTTP by default. Include https:// for local HTTPS.</FieldDescription>
            )}
        </FieldSet>
    );
}
