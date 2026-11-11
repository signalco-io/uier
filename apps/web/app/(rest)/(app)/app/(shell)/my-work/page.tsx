
import { getAppI18n } from '@/src/lib/i18n/server';
import { PageLoading } from '@/src/components/app/PageLoading';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AtSignIcon, CircleCheckIcon, MailIcon, UserIcon } from 'lucide-react';
import { requireAppContext } from '@/src/lib/app/context';
import { loadMyWork, type MyWorkItem } from '@/src/lib/app/myWork';
import { PageHeader } from '@/src/components/app/PageHeader';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { MyWorkKeys, MyWorkList } from '@/src/components/app/comments/MyWorkList';

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
    const { assigned, mentions, unread, capped } = await loadMyWork(context, t);
    const empty = !assigned.length && !mentions.length && !unread.length;
    return (
        <>
            <PageHeader title={t("My work")} />
            {empty ? (
                <Empty className="border">
                    <EmptyHeader>
                        <EmptyMedia variant="icon"><CircleCheckIcon /></EmptyMedia>
                        <EmptyTitle>{t("Nothing needs you")}</EmptyTitle>
                        <EmptyDescription>{t("Threads assigned to you, threads that mention you and unread activity show here.")}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            ) : (
                // J and K go to the next and the previous row across the groups
                <MyWorkKeys>
                    <Group id="my-work-assigned" title={t("Assigned to you")} description={t("Open threads you are the assignee of")} icon={<UserIcon />} items={assigned} />
                    <Group id="my-work-mentions" title={t("Mentions you")} description={t("Open threads whose messages mention you")} icon={<AtSignIcon />} items={mentions} />
                    <Group id="my-work-unread" title={t("Unread")} description={t("Other threads with activity you have not read")} icon={<MailIcon />} items={unread} />
                </MyWorkKeys>
            )}
            {capped && <p className="mt-4 text-sm text-muted-foreground">{t("Each project lists up to its 1,000 most recent threads here.")}</p>}
        </>
    );
}

export default function MyWorkPage() {
    return <Suspense fallback={<PageLoading title="Loading my work" />}><MyWorkPageContent /></Suspense>;
}
