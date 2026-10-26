import { useContext } from 'react';
import { SelectItems } from '@signalco/ui-primitives/SelectItems';
import { File, Layers } from '@signalco/ui-icons';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { useInkContainer } from '../InkScope';
import type { CommentsPageFilter } from './CommentsFilter';
import { pageKeyPath, type InboxPage } from './useInboxComments';

type PagePickerProps = {
    value: CommentsPageFilter;
    pages: InboxPage[];
    currentCount: number;
    otherCount: number;
    onChange: (value: CommentsPageFilter) => void;
};

/** "This page", "All pages" or the other page's path */
export function pageLabel(value: CommentsPageFilter) {
    return value === 'current' ? 'This page' : value === 'all' ? 'All pages' : pageKeyPath(value);
}

/** An option's name and its matching comments */
function PageOption({ label, count, detail }: { label: string; count: number; detail?: string }) {
    return (
        <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate">{label}</span>
            {detail && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count}</span>
        </span>
    );
}

/**
 * Which pages the inbox lists: this page (the default), all pages, or one of the site's other
 * pages (newest activity first), each with its comments that match the search and status. The UI
 * kit's select: typing the start of a path jumps to it.
 */
export function PagePicker({ value, pages, currentCount, otherCount, onChange }: PagePickerProps) {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const container = useInkContainer() ?? rootElement;
    const pageIcon = <File size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />;
    return (
        <SelectItems<CommentsPageFilter>
            container={container ?? undefined}
            placeholder="Pages"
            className="min-w-0 flex-1 [&_[role=combobox]]:h-8"
            value={value}
            onValueChange={onChange}
            items={[
                { value: 'current', icon: pageIcon, label: <PageOption label="This page" count={currentCount} /> },
                { value: 'all', icon: <Layers size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />, label: <PageOption label="All pages" count={currentCount + otherCount} /> },
                ...pages.map(page => ({
                    value: page.key,
                    icon: pageIcon,
                    title: page.path,
                    label: <PageOption label={page.path} count={page.count} detail={page.environmentLabel} />
                }))
            ]} />
    );
}
