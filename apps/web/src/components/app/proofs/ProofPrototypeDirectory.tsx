'use client';

import { useId, useState } from 'react';
import { zipSync } from 'fflate';
import { Field, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { useAppI18n } from '@/src/lib/i18n/client';
import { MAX_PROOF_UPLOAD_BYTES } from '@/src/lib/proofs/model';

export function ProofPrototypeDirectory({ disabled, onChange }: { disabled: boolean; onChange: (file: File) => void }) {
    const { t } = useAppI18n();
    const id = useId();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    return <Field>
        <FieldLabel htmlFor={id}>{t('Choose prototype directory')}</FieldLabel>
        <Input id={id} type="file" {...{ webkitdirectory: '' }} multiple disabled={disabled || busy} onChange={event => {
            const input = event.currentTarget;
            const files = Array.from(input.files ?? []);
            if (!files.length) return;
            setError('');
            setBusy(true);
            void packageDirectory(files).then(onChange).catch(error => setError(error instanceof Error ? error.message : 'The directory could not be read.'))
                .finally(() => { input.value = ''; setBusy(false); });
        }} />
        <FieldDescription>{t('Choose a folder with index.html, then submit it as a file or version.')}</FieldDescription>
        {error && <p role="alert" className="m-0 text-sm text-destructive">{t(error)}</p>}
    </Field>;
}

async function packageDirectory(files: File[]) {
    if (files.length > 100 || files.reduce((size, file) => size + file.size, 0) > MAX_PROOF_UPLOAD_BYTES)
        throw new Error('Choose a directory with up to 100 files and 20 MB.');
    const entries: Record<string, Uint8Array> = Object.create(null);
    for (const file of files) entries[file.webkitRelativePath] = new Uint8Array(await file.arrayBuffer());
    const zip = zipSync(entries, { level: 0 });
    if (zip.byteLength > MAX_PROOF_UPLOAD_BYTES) throw new Error('The directory ZIP exceeds 20 MB.');
    return new File([new Uint8Array(zip)], (files[0]?.webkitRelativePath.split('/')[0] || 'prototype') + '.zip', { type: 'application/zip' });
}
