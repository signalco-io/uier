'use client';

import { AccessibilityIcon, BugIcon, CodeIcon, FileTextIcon, FlagIcon, PaintbrushIcon, SparklesIcon, TagIcon } from 'lucide-react';
import { labelColorTokens, type ThreadLabel } from '@/src/lib/app/threadLabel';
import { Badge } from '../ui/badge';

const icons = { tag: TagIcon, bug: BugIcon, sparkles: SparklesIcon, accessibility: AccessibilityIcon, paintbrush: PaintbrushIcon, code: CodeIcon, 'file-text': FileTextIcon, flag: FlagIcon };
export function ThreadLabelMark({ label }: { label: ThreadLabel }) {
    if (!label.icon) return <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(var(${labelColorTokens[label.color]}))` }} />;
    const Icon = icons[label.icon];
    return <Icon aria-hidden="true" data-icon="inline-start" style={{ stroke: `hsl(var(${labelColorTokens[label.color]}))` }} />;
}
export function ThreadLabelBadge({ label }: { label: ThreadLabel }) {
    return <Badge variant="outline" title={label.description || undefined} className="max-w-full"><ThreadLabelMark label={label} /><span className="truncate">{label.name}</span></Badge>;
}
