'use client';

import { useId, useState } from 'react';
import { Input } from '@signalco/ui-primitives/Input';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Add, Delete } from '@signalco/ui-icons';
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
        <div className="flex flex-col gap-3">
            {rows.map((row, index) => (
                <div key={row.key} className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <Input
                            id={`${idPrefix}-${row.key}`}
                            label={index === 0 ? 'Main site address' : 'Other address'}
                            name="url"
                            value={row.url}
                            onChange={(event) => setUrl(row.key, event.target.value)}
                            required={index === 0}
                            inputMode="url"
                            autoComplete="url"
                            spellCheck={false}
                            placeholder={index === 0 ? 'example.com' : 'staging.example.com'}
                            fullWidth />
                    </div>
                    {index > 0 && (
                        <IconButton
                            type="button"
                            variant="plain"
                            aria-label={`Remove address ${index + 1}`}
                            title="Remove address"
                            onClick={() => removeRow(row.key)}>
                            <Delete />
                        </IconButton>
                    )}
                </div>
            ))}
            {rows.length < MAX_PROJECT_URLS && (
                <Button
                    type="button"
                    variant="plain"
                    size="sm"
                    className="self-start"
                    startDecorator={<Add className="size-4" />}
                    onClick={addRow}>
                    Add another address
                </Button>
            )}
        </div>
    );
}
