
import { useAppI18n } from '@/src/lib/i18n/client';
'use client';

import { agentSessionLink } from '@uier/toolbar/agents';
import { buttonVariants } from '@/src/components/ui/button';

/** Check again at the rendering boundary, including older stored data and optimistic edits. */
export function AgentSessionLink({ sessionUrl }: { sessionUrl?: string }) {
    const { t } = useAppI18n();
    const link = agentSessionLink(sessionUrl);
    return link ? <a href={link.url} className={buttonVariants({ variant: 'link', size: 'xs', className: 'h-auto self-start px-0 font-normal pointer-coarse:min-h-11' })}>
        {t("Open in ")}{link.app}
    </a> : null;
}
