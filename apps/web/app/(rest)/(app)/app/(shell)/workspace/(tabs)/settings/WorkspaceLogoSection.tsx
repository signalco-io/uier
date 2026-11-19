'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUpIcon } from 'lucide-react';
import { dropTargetClassName, usePictureUpload } from '@/src/components/app/EditablePicture';
import { Section } from '@/src/components/app/PageHeader';
import { WorkspaceMark } from '@/src/components/app/workspace/WorkspaceMark';
import { Button } from '@/src/components/ui/button';
import { Field, FieldDescription, FieldError } from '@/src/components/ui/field';
import { Spinner } from '@/src/components/ui/spinner';
import { KnownPageLinks } from '@/src/knownPages';
import { useAppI18n } from '@/src/lib/i18n/client';
import { cn } from '@/src/lib/utils';

export function WorkspaceLogoSection({ workspaceId, logoVersion }: { workspaceId: string; logoVersion?: string }) {
    const { t } = useAppI18n();
    const router = useRouter();
    const descriptionId = useId();
    const uploadButton = useRef<HTMLButtonElement>(null);
    const [status, setStatus] = useState('');
    const { pending, error, fileInput, dropTarget, choose, remove } = usePictureUpload({
        endpoint: KnownPageLinks.workspaceLogoUpload(workspaceId),
        fileLabel: t("Workspace logo"),
        failed: t("The logo could not be saved."),
        resizeBeforeUpload: false,
        onPendingChange: saving => { if (saving) setStatus(''); },
        onSaved: method => {
            if (method === 'DELETE') uploadButton.current?.focus();
            setStatus(method === 'POST' ? t("Logo saved.") : t("Logo removed."));
            router.refresh();
        }
    });
    return (
        <Section id="logo" title={t("Workspace logo")}>
            <Field data-invalid={error ? true : undefined} className={cn('rounded-lg', dropTargetClassName)} {...dropTarget}>
                <div className="flex flex-wrap items-center gap-3">
                    <WorkspaceMark logoUrl={logoVersion ? KnownPageLinks.workspaceLogo(workspaceId, logoVersion) : undefined} />
                    <div className="flex flex-wrap gap-2">
                        <Button ref={uploadButton} variant="outline" className="pointer-coarse:min-h-11" disabled={pending} focusableWhenDisabled
                            aria-describedby={descriptionId} onClick={choose}>
                            {pending ? <Spinner data-icon="inline-start" /> : <ImageUpIcon data-icon="inline-start" />}
                            {logoVersion ? t("Change logo") : t("Upload logo")}
                        </Button>
                        {logoVersion && <Button variant="ghost" className="pointer-coarse:min-h-11" disabled={pending}
                            focusableWhenDisabled onClick={remove}>{t("Remove logo")}</Button>}
                    </div>
                </div>
                {fileInput}
                <FieldDescription id={descriptionId}>{t("Shown next to the workspace name in the sidebar. PNG, JPEG, WebP or GIF, up to 4 MB and 4096 pixels on each side.")}</FieldDescription>
                {error && <FieldError>{error}</FieldError>}
                <span className="sr-only" role="status">{status}</span>
            </Field>
        </Section>
    );
}
