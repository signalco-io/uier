
import { getAppI18n } from '@/src/lib/i18n/server';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CircleCheckIcon } from 'lucide-react';
import { feedbackStages } from '@uier/toolbar/verification';
import { requireAppContext } from '@/src/lib/app/context';
import { loadMyWork } from '@/src/lib/app/myWork';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { MyWorkViews } from '@/src/components/app/comments/MyWorkBoard';
import { MyWorkHeader, MyWorkLoading } from '@/src/components/app/comments/MyWorkLoading';

/** The board's columns and the gaps between them (20rem a column, no Archive): the width its header takes */
const boardWidth = `calc(${feedbackStages.length} * 20rem + ${feedbackStages.length - 1}rem)`;

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("My work") };
}

/** What needs the signed-in member across the workspace's projects they can see */
async function MyWorkPageContent() {
    const { t } = await getAppI18n();
    const context = await requireAppContext();
    const { assigned, mentions, unread, capped, assignees } = await loadMyWork(context, t);
    return (
        <>
            {/* Always mounted, empty too: My work's board keeps the threads changed on it, and its open thread, until a reload.
                The groups as lists, or every thread on a board (List/Board, `?view=`), under search and Filter */}
            <MyWorkViews assigned={assigned} mentions={mentions} unread={unread} assignees={assignees} userId={context.user.id} empty={(
                <Empty data-my-work-empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon"><CircleCheckIcon /></EmptyMedia>
                        <EmptyTitle>{t("Nothing needs you")}</EmptyTitle>
                        <EmptyDescription>{t("Threads assigned to you, threads that mention you and unread activity show here.")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )} />
            {capped && <p className="mt-4 text-sm text-muted-foreground">{t("Each project lists up to its 1,000 most recent threads here.")}</p>}
        </>
    );
}

/**
 * The title is the page's shell (`MyWorkHeader`): one mounted heading, there before the threads. Search, Filter and
 * List/Board are under it, as on a project's comments, but only when something needs the person (`MyWorkViews`), so
 * they arrive with the threads; `MyWorkLoading` keeps their place.
 */
export default function MyWorkPage() {
    return (
        // On the board the header is as wide as its columns, up to the panel's width less the gutters, as on a project's
        // board (the board marks itself with `data-header-wide`)
        <div className="group/my-work flex flex-col" style={{ '--board-width': boardWidth } as React.CSSProperties}>
            <MyWorkHeader />
            <Suspense fallback={<MyWorkLoading />}><MyWorkPageContent /></Suspense>
        </div>
    );
}
