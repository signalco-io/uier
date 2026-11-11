'use client';

import { useAppI18n } from '@/src/lib/i18n/client';
import type { ComponentProps } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/src/components/ui/button';
import { Spinner } from '@/src/components/ui/spinner';
import { deferredComponent } from '../deferredComponent';

type BoardProps = ComponentProps<typeof import('./CommentBoard').CommentBoard>;

function LoadingBoard() {
    const { t } = useAppI18n();
    return <div role="status" className="flex min-h-64 items-center justify-center gap-2"><Spinner />{t('Loading board…')}</div>;
}

function FailedBoard({ retry }: { retry: () => void }) {
    const { t } = useAppI18n();
    return <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-3">
        <p className="m-0 text-muted-foreground">{t('The board could not load.')}</p>
        <Button variant="outline" onClick={retry}>{t('Try loading the board again')}</Button>
    </div>;
}

const loading = <LoadingBoard />;
// Next registers these chunks while server-rendering a direct Board visit. A List render never
// mounts this component, so its board code is not preloaded before the view is selected.
const InitialBoard = dynamic<BoardProps>(() => import('./CommentBoard').then(module => module.CommentBoard), {
    loading: () => loading
});

/** List visits do not load the board. A direct Board visit still renders through Suspense on the server. */
export const LazyCommentBoard = deferredComponent<BoardProps>(
    () => import('./CommentBoard').then(module => ({ default: module.CommentBoard })),
    {
        initial: InitialBoard,
        loading,
        failed: retry => <FailedBoard retry={retry} />
    }
);
