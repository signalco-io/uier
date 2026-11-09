'use client';

import { Fragment, type ReactElement } from 'react';
import Link from 'next/link';
import { ChevronDownIcon, ExternalLinkIcon, GlobeIcon, MessageSquareIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/src/components/ui/tooltip';
import { KnownPageLinks } from '../../../knownPages';
import { cn } from '@/src/lib/utils';
import { displayUrl } from './projectLabels';

/**
 * Opens the project's sites in review mode (a new tab). One address is a plain button; more
 * addresses (staging, previews) are a dropdown with the main site first. With `visit`, it is always
 * a dropdown that also opens each site as it is, without review.
 * With `compact` (the projects list's cards), it is a quiet icon button with an "Open review" tooltip,
 * named for the project so each card's button has its own name.
 */
export function ReviewLinksMenu({ projectId, urls, size = 'default', variant = 'outline', visit = false, compact }: {
    projectId: string;
    urls: string[];
    size?: 'sm' | 'default';
    variant?: 'outline' | 'default';
    visit?: boolean;
    compact?: { projectName: string; className?: string };
}) {
    const [mainUrl] = urls;
    if (!mainUrl)
        return null;

    // Not links: Next.js would prefetch them, and a review link redirects to the site with a
    // single-use code (app/review), which must only be minted when someone opens it
    const open = (url: string) => window.open(KnownPageLinks.projectReview(projectId, url), '_blank', 'noopener');

    if (compact) {
        const single = urls.length === 1 && !visit;
        const button = (
            <Button variant="ghost" size="icon-sm" aria-label={`Open review for ${compact.projectName}`}
                onClick={single ? () => open(mainUrl) : undefined}
                className={cn('text-muted-foreground hover:text-foreground', compact.className)} />
        );
        const trigger = (render: ReactElement) => (
            <Tooltip>
                <TooltipTrigger render={render}>
                    <ExternalLinkIcon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>Open review</TooltipContent>
            </Tooltip>
        );
        if (single)
            return trigger(button);
        return (
            <DropdownMenu>
                {trigger(<DropdownMenuTrigger render={button} />)}
                <ReviewLinksMenuContent projectId={projectId} urls={urls} visit={visit} open={open} />
            </DropdownMenu>
        );
    }

    if (urls.length === 1 && !visit) {
        return (
            <Button variant={variant} size={size} onClick={() => open(mainUrl)}>
                Open review
                <ExternalLinkIcon data-icon="inline-end" />
            </Button>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant={variant} size={size} />}>
                Open review
                <ChevronDownIcon data-icon="inline-end" />
            </DropdownMenuTrigger>
            <ReviewLinksMenuContent projectId={projectId} urls={urls} visit={visit} open={open} />
        </DropdownMenu>
    );
}

/** The menu's addresses (Review and Visit site with `visit`, else one review link each) and Review setup */
function ReviewLinksMenuContent({ projectId, urls, visit, open }: {
    projectId: string;
    urls: string[];
    visit: boolean;
    open: (url: string) => void;
}) {
    return (
        <DropdownMenuContent align="end" className="max-w-[min(24rem,calc(100vw-2rem))] min-w-56">
            {visit ? urls.map((url, index) => (
                <Fragment key={url}>
                    {index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuGroup aria-label={displayUrl(url)}>
                        <DropdownMenuLabel className="flex min-w-0 flex-col text-xs font-normal text-muted-foreground">
                            <span className="truncate font-mono text-[13px] text-foreground">{displayUrl(url)}</span>
                            {index === 0 && urls.length > 1 && <span>Main site</span>}
                        </DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => open(url)}>
                            <MessageSquareIcon />
                            Review
                            <ExternalLinkIcon className="ml-auto" />
                        </DropdownMenuItem>
                        <DropdownMenuItem render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
                            <GlobeIcon />
                            Visit site
                            <ExternalLinkIcon className="ml-auto" />
                        </DropdownMenuItem>
                    </DropdownMenuGroup>
                </Fragment>
            )) : (
                <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Review links</DropdownMenuLabel>
                    {urls.map((url, index) => (
                        <DropdownMenuItem key={url} onClick={() => open(url)}>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate font-mono text-[13px]">{displayUrl(url)}</span>
                                {index === 0 && <span className="text-xs text-muted-foreground">Main site</span>}
                            </span>
                            <ExternalLinkIcon className="ml-auto" />
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
                <DropdownMenuItem render={<Link href={KnownPageLinks.projectInstall(projectId)} />}>Review setup</DropdownMenuItem>
            </DropdownMenuGroup>
        </DropdownMenuContent>
    );
}
