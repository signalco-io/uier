import { Pin } from '@uier/brand';
import { getAppI18n } from '@/src/lib/i18n/server';
import { cn } from '@/src/lib/utils';

/**
 * The open comment count inside uier's own comment pin (`<Pin />`, the product pin with the number in it, uier #430),
 * at 28px so two digits read at 11px and five still fit; it keeps the card's meta line height. Its name is the
 * count in words ("11 open comments").
 */
export async function CommentCount({ count, className }: { count: number; className?: string }) {
    const { t, language } = await getAppI18n();
    const category = new Intl.PluralRules(language).select(count);
    const words = category === 'one' ? t(" open comment") : category === 'few' ? t(" open comments [few]") : t(" open comments");
    return (
        <Pin number={count} size={28} label={`${count}${words}`} className={cn('-my-1 shrink-0', className)} />
    );
}
