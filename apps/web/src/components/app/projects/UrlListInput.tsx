'use client';

import { useId, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Field, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { MAX_PROJECT_URLS } from '../../../lib/app/limits';

/**
 * The site addresses of a project as `url` form fields: the main site first, then any others
 * (staging, preview). Empty fields are ignored when the form is saved. The fields are controlled,
 * so React's reset after a form action never drops what was typed.
 */
export function UrlListInput({ defaultUrls = [] }: { defaultUrls?: string[] }) {
    const idPrefix = useId();
    const [rows, setRows] = useState(() => (defaultUrls.length ? defaultUrls : ['']).map((url, index) => ({ key: index, url })));
    const [nextKey, setNextKey] = useState(rows.length);

    const addRow = () => {
        setRows(current => [...current, { key: nextKey, url: '' }]);
        setNextKey(key => key + 1);
    };

    const removeRow = (key: number) => setRows(current => current.filter(row => row.key !== key));
    const setUrl = (key: number, url: string) => setRows(current => current.map(row => row.key === key ? { ...row, url } : row));

    return (
        <>
            {rows.map((row, index) => (
                <Field key={row.key}>
                    <FieldLabel htmlFor={`${idPrefix}-${row.key}`}>{index === 0 ? 'Main site address' : 'Other address'}</FieldLabel>
                    <div className="flex items-center gap-2">
                        <Input
                            id={`${idPrefix}-${row.key}`}
                            name="url"
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
                </Field>
            ))}
            {rows.length < MAX_PROJECT_URLS && (
                <Button type="button" variant="ghost" size="sm" className="self-start" onClick={addRow}>
                    <PlusIcon data-icon="inline-start" />
                    Add another address
                </Button>
            )}
        </>
    );
}
