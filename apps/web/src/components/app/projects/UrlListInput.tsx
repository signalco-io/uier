'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { cn } from '@/src/lib/utils';
import { MAX_PROJECT_URLS } from '../../../lib/app/limits';

/**
 * The site addresses of a project as `url` form fields: one list, the main site first, then any
 * others (staging, preview). The last row looks like an empty address: clicking it adds a field and
 * focuses it. Empty fields are ignored when the form is saved. The fields are controlled, so React's
 * reset after a form action never drops what was typed.
 */
export function UrlListInput({ defaultUrls = [], description, hideLegend = false }: {
    defaultUrls?: string[];
    description?: ReactNode;
    /** When a heading around the list already says "Site addresses" (the legend stays for screen readers) */
    hideLegend?: boolean;
}) {
    const idPrefix = useId();
    const [rows, setRows] = useState(() => (defaultUrls.length ? defaultUrls : ['']).map((url, index) => ({ key: index, url })));
    const [nextKey, setNextKey] = useState(rows.length);
    const [focusKey, setFocusKey] = useState<number | null>(null);

    // A field added by the last row takes the focus, so typing continues where the click was
    useEffect(() => {
        if (focusKey !== null)
            document.getElementById(`${idPrefix}-${focusKey}`)?.focus();
    }, [focusKey, idPrefix]);

    const addRow = () => {
        setRows(current => [...current, { key: nextKey, url: '' }]);
        setFocusKey(nextKey);
        setNextKey(key => key + 1);
    };

    const removeRow = (key: number) => setRows(current => current.filter(row => row.key !== key));
    const setUrl = (key: number, url: string) => setRows(current => current.map(row => row.key === key ? { ...row, url } : row));

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
                            placeholder={index === 0 ? 'example.com' : 'staging.example.com'}
                            className="font-mono text-[13px] md:text-[13px]" />
                        {index > 0 && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove address ${index + 1}`}
                                onClick={() => removeRow(row.key)}>
                                <XIcon />
                            </Button>
                        )}
                    </div>
                ))}
                {rows.length < MAX_PROJECT_URLS && (
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={addRow}
                            className="flex-1 justify-start border-dashed border-input bg-transparent font-mono text-[13px] font-normal text-muted-foreground hover:bg-muted/50 active:not-aria-[haspopup]:translate-y-0">
                            Add another address
                        </Button>
                        {/* Lines up with the fields that have a remove button */}
                        {rows.length > 1 && <span aria-hidden="true" className="size-9 shrink-0" />}
                    </div>
                )}
            </div>
        </FieldSet>
    );
}
