'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import { ImageUpIcon, Trash2Icon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/src/components/ui/dropdown-menu';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { dropTargetClassName, EditablePicture, usePictureUpload } from '@/src/components/app/EditablePicture';
import { Section } from '@/src/components/app/PageHeader';
import { PersonAvatar } from '@/src/components/app/PersonAvatar';
import { SaveFooter, useSettingsDraft } from '@/src/components/app/SettingsSave';
import { themeOptions } from '@/src/components/app/shell/AccountMenu';
import { KnownPages } from '@/src/knownPages';
import { MAX_NAME_LENGTH } from '@/src/lib/app/limits';
import { cn } from '@/src/lib/utils';
import { updateNameAction } from './actions';

/**
 * The profile picture: the avatar is the button that opens Upload picture (and Remove picture once there
 * is one); an image can also be dropped on it or pasted while it or its menu has focus. Each change saves
 * at once, like a switch; the name beside it saves with the form.
 */
function ProfilePicture({ name, avatarUrl, descriptionId }: { name: string; avatarUrl?: string; descriptionId: string }) {
    const { t, language } = useAppI18n();
    const router = useRouter();
    // While a change saves, the menu stays closed but the avatar keeps the focus: a disabled trigger
    // can't take it back from the closing menu, which would leave it on the page's body
    const [open, setOpen] = useState(false);
    const { pending, error, fileInput, dropTarget, choose, remove } = usePictureUpload({
        endpoint: KnownPages.AccountAvatar,
        fileLabel: t("Profile picture file"),
        failed: t("Your picture could not be saved."),
        // An image dropped or pasted into the open menu closes it, like choosing one of its items
        onPendingChange: (next) => {
            if (next) setOpen(false);
        },
        onSaved: (method) => {
            toast(method === 'POST' ? t("Your picture is saved.") : t("Your picture is removed."));
            router.refresh();
        }
    });
    return (
        <>
            <DropdownMenu open={open} onOpenChange={next => setOpen(next && !pending)}>
                <DropdownMenuTrigger render={<EditablePicture aria-label={t("Edit profile picture")} aria-describedby={descriptionId} pending={pending} {...dropTarget} />}>
                    <PersonAvatar name={name} avatarUrl={avatarUrl} aria-hidden="true" className="size-16" fallbackClassName="text-xl" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className={cn('w-auto', dropTargetClassName)} {...dropTarget}>
                    <DropdownMenuItem onClick={choose}>
                        <ImageUpIcon />
                        {avatarUrl ? t("Upload a new picture") : t("Upload picture")}
                    </DropdownMenuItem>
                    {avatarUrl && (
                        <DropdownMenuItem onClick={remove}>
                            <Trash2Icon />
                            {t("Remove picture")}{' '}</DropdownMenuItem>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            {fileInput}
            {error && <FieldError className="order-last basis-full">{error}</FieldError>}
        </>
    );
}

export function AccountForm({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
    const { t, language } = useAppI18n();
    const formId = useId();
    const [state, formAction, pending] = useActionState(updateNameAction, null);
    const { draft, dirty, update, discard } = useSettingsDraft(name, state);
    return (
        <Section
            id="profile"
            title={t("Profile")}
            footer={<SaveFooter formId={formId} state={state} pending={pending} dirty={dirty} onDiscard={discard} />}>
            <div className="flex flex-col gap-3">
                {/* The picture on the left, the name on the right (the label's row is the avatar's top) */}
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3 sm:gap-x-6">
                    <ProfilePicture name={name} avatarUrl={avatarUrl} descriptionId={`${formId}-picture`} />
                    <form id={formId} action={formAction} className="min-w-0 flex-1">
                        <Field>
                            <FieldLabel htmlFor={`${formId}-name`}>{t("Name")}</FieldLabel>
                            <Input
                                id={`${formId}-name`}
                                name="name"
                                value={draft}
                                onChange={(event) => update(() => event.target.value)}
                                required
                                maxLength={MAX_NAME_LENGTH}
                                autoComplete="name"
                                className="max-w-md" />
                            <FieldDescription>{t("Shown with your comments and to the people you work with.")}</FieldDescription>
                        </Field>
                    </form>
                </div>
                <FieldDescription id={`${formId}-picture`}>{t("Your picture is shown beside your name. PNG, JPEG, WebP or GIF, cropped to a square. Drop an image on it or paste one to change it.")}</FieldDescription>
            </div>
        </Section>
    );
}

/** Light, dark or the system's theme for the app (and the site), kept in this browser */
export function AppearanceSection() {
    const { t, language } = useAppI18n();
    const { theme, setTheme } = useTheme();
    // next-themes only knows the theme on the client; show "system" until mounted
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    return (
        <Section id="appearance" title={t("Appearance")} description={t("How uier looks in this browser.")}>
            <ToggleGroup
                variant="outline"
                aria-label={t("Theme")}
                value={[mounted ? (theme ?? 'system') : "system"]}
                onValueChange={([next]) => next && setTheme(next)}>
                {themeOptions.map(option => (
                    <ToggleGroupItem key={option.value} value={option.value} className="px-3">
                        <option.icon data-icon="inline-start" />
                        {t(option.label)}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </Section>
    );
}
