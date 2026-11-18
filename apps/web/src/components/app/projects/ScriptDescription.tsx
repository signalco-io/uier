'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

/**
 * What the script does, said once wherever it is offered: the install guide, onboarding's script step and that step's
 * loading state, which draws it before the project is read (so it takes the language from the app's provider).
 */
export function ScriptDescription() {
    const { t } = useAppI18n();
    return <>{t("Paste it before the closing")}{' '}<code className="font-mono">&lt;/body&gt;</code>{' '}{t("tag on every page you want to review. The toolbar opens through a review link, or automatically for signed-in project members when background sign-in is available.")}</>;
}
