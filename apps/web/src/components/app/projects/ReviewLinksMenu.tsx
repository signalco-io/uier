'use client';

import { ChevronDownIcon, ExternalLinkIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { KnownPageLinks } from '../../../knownPages';
import { displayUrl } from './projectLabels';

/**
 * Opens the project's sites in review mode (a new tab). One address is a plain button; more
 * addresses (staging, previews) are a dropdown with the main site first.
 */
export function ReviewLinksMenu({ projectId, urls, size = 'default', variant = 'outline' }: {
    projectId: string;
    urls: string[];
    size?: 'sm' | 'default';
    variant?: 'outline' | 'default';
}) {
    const [mainUrl] = urls;
    if (!mainUrl)
        return null;

    // Not links: Next.js would prefetch them, and a review link redirects to the site with a
    // single-use code (app/review), which must only be minted when someone opens it
    const open = (url: string) => window.open(KnownPageLinks.projectReview(projectId, url), '_blank', 'noopener');

    if (urls.length === 1) {
        return (
            <Button variant={variant} size={size} onClick={() => open(mainUrl)}>
                Open review
                <ExternalLinkIcon data-icon="inline-end" />
            </Button>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant={variant} size={size}>
                    Open review
                    <ChevronDownIcon data-icon="inline-end" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[min(24rem,calc(100vw-2rem))] min-w-56">
                <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Review links</DropdownMenuLabel>
                    {urls.map((url, index) => (
                        <DropdownMenuItem key={url} onSelect={() => open(url)}>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate font-mono text-[13px]">{displayUrl(url)}</span>
                                {index === 0 && <span className="text-xs text-muted-foreground">Main site</span>}
                            </span>
                            <ExternalLinkIcon className="ml-auto" />
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
