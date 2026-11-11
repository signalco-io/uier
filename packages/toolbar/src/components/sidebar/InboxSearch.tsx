import { useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { Search } from '@signalco/ui-icons';
import { IconTooltip } from '../IconTooltip';
import { floatingShadowClassName } from '../@types/Comments';
import { useMessages } from '../../i18n';

// One element for every render: the kit's input wraps itself anew (and loses the focus) when its
// decorator changes
const searchIcon = <Search size={16} aria-hidden="true" className="ml-3 shrink-0 text-muted-foreground" />;

/**
 * The inbox's search: a small icon button in its title row (filled while a search applies, its name then says the
 * words) that opens the search field in a popover under the title row, over the filters. It stays in the panel, so
 * the panel's landmark holds it. Opening it focuses the field and selects its text. Escape in a field with text clears
 * it; in an empty one it closes the popover (back on the button). Moving the focus out of it closes it too; the search
 * still applies.
 */
export function InboxSearch({ value, onChange, open, onOpenChange }: {
    value: string;
    onChange: (value: string) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const t = useMessages();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const active = Boolean(value.trim());
    const close = (focusButton: boolean) => {
        onOpenChange(false);
        if (focusButton) buttonRef.current?.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        // Never the inbox's Escape
        event.stopPropagation();
        event.preventDefault();
        if (value) onChange('');
        else close(true);
    };
    const handleBlur = (event: FocusEvent) => {
        const next = event.relatedTarget as Node | null;
        if (next && (boxRef.current?.contains(next) || buttonRef.current?.contains(next))) return;
        close(false);
    };
    return <>
        <IconTooltip label={t.inbox.search}>
            <IconButton ref={buttonRef} variant="plain" size="sm" aria-label={active ? `${t.inbox.search}: ${value.trim()}` : t.inbox.search}
                aria-expanded={open} aria-controls="uier-inbox-search" data-uier-inbox-search=""
                className={cx(active && 'bg-accent')}
                onClick={() => onOpenChange(!open)}>
                <Search size={16} aria-hidden="true" />
            </IconButton>
        </IconTooltip>
        {open && (
            <div ref={boxRef} id="uier-inbox-search" role="search" onKeyDown={handleKeyDown} onBlur={handleBlur}
                className={cx('absolute inset-x-0 top-full z-20 mt-2 rounded-xl border bg-card p-1', floatingShadowClassName)}>
                <SearchField value={value} onChange={onChange} />
            </div>
        )}
    </>;
}

/** Focused, its text selected, as it opens (and again for each `/`, see `CommentsSidebar`) */
function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const t = useMessages();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const input = ref.current?.querySelector('input');
        input?.focus();
        input?.select();
    }, []);
    return (
        // With a decorator the kit's focus ring is on the box, which never has the focus itself
        <div ref={ref}><Input
            type="search"
            aria-label={t.inbox.search}
            placeholder={t.inbox.search}
            autoComplete="off"
            fullWidth
            startDecorator={searchIcon}
            className="focus-within:ring-2 focus-within:ring-ring"
            value={value}
            onChange={event => onChange(event.target.value)} /></div>
    );
}
