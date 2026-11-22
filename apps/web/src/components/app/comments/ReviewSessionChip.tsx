'use client';

import { Badge } from '@/src/components/ui/badge';
import { setUrlSearchParams } from '@/src/hooks/use-url-search-params';
import { useAppI18n } from '@/src/lib/i18n/client';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';

export function ReviewSessionChip({ review, interactive = true }: { review?: ProjectCommentView['reviewSession']; interactive?: boolean }) {
    const { t } = useAppI18n();
    if (!review) return null;
    const title = review.number ? t('Review {number}', { number: review.number }) : t('Review session');
    return <>
        {review.held && <Badge data-review-held variant="outline" className="whitespace-nowrap text-muted-foreground">{t('Not sent')}</Badge>}
        {review.number && (interactive
            ? <Badge data-review-session={review.id} variant="outline" render={<button type="button"
                onClick={event => {
                    event.stopPropagation();
                    setUrlSearchParams({ reviewSessionId: review.id, status: 'all', view: 'list', comment: undefined }, { history: 'push' });
                }} />} className="relative z-10 overflow-visible whitespace-nowrap hover:bg-muted pointer-coarse:after:absolute pointer-coarse:after:-inset-y-3 pointer-coarse:after:inset-x-0">
                {title}
            </Badge>
            : <Badge variant="outline">{title}</Badge>)}
    </>;
}
