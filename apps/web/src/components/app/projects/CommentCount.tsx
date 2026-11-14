import { Mark } from '@uier/brand';
import { getAppI18n } from '@/src/lib/i18n/server';
import { cn } from '@/src/lib/utils';

/**
 * The open comment count after uier's own comment icon, the pin (the mark, `<Mark />` in the text colour), at the
 * 16px of the card's other meta icons; the words are for screen readers ("11 open comments").
 */
export async function CommentCount({ count, className }: { count: number; className?: string }) {
    const { t, language } = await getAppI18n();
    const category = new Intl.PluralRules(language).select(count);
    return (
        <span className={cn('flex shrink-0 items-center gap-1.5 tabular-nums', className)}>
            <Mark size={16} className="shrink-0" />
            {count}
            <span className="sr-only">{category === 'one' ? t(" open comment") : category === 'few' ? t(" open comments [few]") : t(" open comments")}</span>
        </span>
    );
}
