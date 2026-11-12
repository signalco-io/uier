'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Logo } from '@uier/brand/Logo';

export function PageLoading({ title = 'Loading page' }: { title?: string }) {
    const { t } = useAppI18n();
    return <div className="flex min-h-64 flex-col gap-6" role="status" aria-label={t(title)}>
        <span className="sr-only">{t(title)}…</span>
        <Skeleton className="h-8 w-48 animate-none" />
        <Skeleton className="h-4 w-64 max-w-full animate-none" />
        <Skeleton className="h-32 w-full animate-none rounded-xl" />
    </div>;
}

export function ShellLoading() {
    const { t } = useAppI18n();
    return <div className="flex min-h-svh bg-sidebar lg:p-2">
        <aside className="hidden w-64 shrink-0 flex-col gap-8 p-6 lg:flex" aria-label={t('App loading')}>
            <Logo size={20} />
            <PageLoading title="Loading navigation" />
        </aside>
        <main className="min-w-0 flex-1 bg-background lg:rounded-xl lg:border">
            <header className="flex h-12 items-center border-b px-3" aria-hidden="true"><Skeleton className="size-6 animate-none" /></header>
            <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8"><PageLoading title="Loading your workspace" /></div>
        </main>
    </div>;
}
