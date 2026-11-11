
import { getAppI18n } from '@/src/lib/i18n/server';
import Link from 'next/link';
import { HistoryIcon } from 'lucide-react';
import { cn } from 'cn';
import { buttonVariants } from '@/src/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import type { DbAccessEvent } from '@/src/lib/app/model';
import { DateTime } from '../comments/DateTime';
import { describeAccessEvent, type ActivityNames } from './activityText';

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/**
 * Access history as sentences, one change per row: who did what ("Maya invited client@example.com to
 * Acme shop"), the details of a changed grant under it, and when. Admins only; kept 180 days.
 */
export async function AccessActivity({ events, names, next }: {
    events: DbAccessEvent[];
    names: ActivityNames;
    /** The page of later changes */
    next?: string;
}) {
    const { t, language } = await getAppI18n();
    if (!events.length) {
        return (
            <Empty className="border">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <HistoryIcon />
                    </EmptyMedia>
                    <EmptyTitle>{t("No access changes yet")}</EmptyTitle>
                    <EmptyDescription>{t("Invitations, removals and team changes show up here for 180 days.")}</EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    }
    return (
        <div className="flex flex-col gap-3">
            <ol aria-label={t("Access changes")} className="m-0 list-none divide-y rounded-xl border p-0">
                {events.map(event => {
                    const { actor, text, details } = describeAccessEvent(event, names, t, language);
                    return (
                        <li key={event.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <p className="m-0 break-words"><span className="font-medium">{actor}</span> {text}.</p>
                                {details.map(detail => <p key={detail} className="m-0 break-words text-muted-foreground">{sentence(detail)}</p>)}
                            </div>
                            <span className="shrink-0 text-xs text-muted-foreground"><DateTime value={event.at} /></span>
                        </li>
                    );
                })}
            </ol>
            {next && <Link href={next} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'self-center')}>{t("Later changes")}</Link>}
        </div>
    );
}
