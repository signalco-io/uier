
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AtSignIcon, CircleCheckIcon, MailIcon, UserIcon } from 'lucide-react';
import { feedbackStages } from '@uier/toolbar/verification';
import { cn } from '@/src/lib/utils';
import { requireAppContext } from '@/src/lib/app/context';
import { loadMyWork, type MyWorkItem } from '@/src/lib/app/myWork';
import { PageHeader } from '@/src/components/app/PageHeader';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { MyWorkKeys, MyWorkList } from '@/src/components/app/comments/MyWorkList';
import { MyWorkViewToggle, MyWorkViews } from '@/src/components/app/comments/MyWorkBoard';

/** The board's columns and the gaps between them (20rem a column, no Archive): the width its header takes */
const boardWidth = `calc(${feedbackStages.length} * 20rem + ${feedbackStages.length - 1}rem)`;

export async function generateMetadata(): Promise<Metadata> {
    const { t } = await getAppI18n();
    return { title: t("My work") };
}

function Group({ id, title, description, icon, items }: { id: string; title: string; description: string; icon: React.ReactNode; items: MyWorkItem[] }) {
    if (!items.length) return null;
    return (
        <section aria-labelledby={id} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 px-1">
                <span aria-hidden="true" className="self-center text-muted-foreground [&_svg]:size-4">{icon}</span>
                <h2 id={id} className="m-0 text-base font-semibold">{title}</h2>
                <span className="text-sm text-muted-foreground tabular-nums">{items.length}</span>
                <p className="m-0 ml-auto hidden text-sm text-muted-foreground sm:block">{description}</p>
            </div>
            <MyWorkList label={title} items={items} />
        </section>
    );
}

/** What needs the signed-in member across the workspace's projects they can see */
async function MyWorkPageContent() {
    const { t } = await getAppI18n();
    const context = await requireAppContext();
    const { assigned, mentions, unread, capped, assignees } = await loadMyWork(context, t);
    return (
        // On the board the header is as wide as its columns, up to the panel's width less the gutters, as on a project's
        // board (the board marks itself with `data-header-wide`)
        <div className="group/my-work flex flex-col" style={{ '--board-width': boardWidth } as React.CSSProperties}>
            {/* Hidden while the page says nothing needs you; a board that keeps threads you just changed keeps it */}
            <PageHeader title={t("My work")} actions={<div className="group-has-[[data-my-work-empty]]/my-work:hidden"><MyWorkViewToggle /></div>}
                className={cn('min-w-0',
                    'group-has-[[data-header-wide=board]]/my-work:md:w-[min(var(--page-wide),max(100%,var(--board-width)))] group-has-[[data-header-wide=board]]/my-work:md:mx-[calc((100%-min(var(--page-wide),max(100%,var(--board-width))))/2)]')} />
            {/* Always mounted, empty too: My work's board keeps the threads changed on it, and its open thread, until a reload */}
            <MyWorkViews items={[...assigned, ...mentions, ...unread]} assignees={assignees} userId={context.user.id} empty={(
                <Empty data-my-work-empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon"><CircleCheckIcon /></EmptyMedia>
                        <EmptyTitle>{t("Nothing needs you")}</EmptyTitle>
                        <EmptyDescription>{t("Threads assigned to you, threads that mention you and unread activity show here.")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            )} list={(
                // The groups as lists, or every thread on a board (List/Board in the header, `?view=`). J and K go to the
                // next and the previous row across the groups
                <MyWorkKeys>
                    <Group id="my-work-assigned" title={t("Assigned to you")} description={t("Open threads you are the assignee of")} icon={<UserIcon />} items={assigned} />
                    <Group id="my-work-mentions" title={t("Mentions you")} description={t("Open threads whose messages mention you")} icon={<AtSignIcon />} items={mentions} />
                    <Group id="my-work-unread" title={t("Unread")} description={t("Other threads with activity you have not read")} icon={<MailIcon />} items={unread} />
                </MyWorkKeys>
            )} />
            {capped && <p className="mt-4 text-sm text-muted-foreground">{t("Each project lists up to its 1,000 most recent threads here.")}</p>}
        </div>
    );
}

export default function MyWorkPage() {
    return <Suspense fallback={<PageLoading title="Loading my work" />}><MyWorkPageContent /></Suspense>;
}
