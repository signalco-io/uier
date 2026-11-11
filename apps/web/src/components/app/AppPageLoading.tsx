
import { getAppI18n } from '@/src/lib/i18n/server';
import { Skeleton } from '@/src/components/ui/skeleton';

/** Keeps the surrounding sidebar, project header and settings navigation interactive. */
export async function AppPageLoading() {
    const { t, language } = await getAppI18n();
    return <div role="status" aria-label={t("Loading page")} className="flex w-full flex-col gap-4">
        <span className="sr-only">{t("Loading page…")}</span>
        <div aria-hidden="true" className="flex flex-col gap-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
        </div>
    </div>;
}
