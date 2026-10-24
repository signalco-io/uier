'use client';

import { Button } from '@signalco/ui-primitives/Button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger
} from '@signalco/ui-primitives/Menu';
import { ExpandDown, ExternalLink } from '@signalco/ui-icons';
import { KnownPageLinks } from '../../../knownPages';
import { displayUrl } from './projectLabels';

/**
 * Opens the project's sites in review mode (a new tab). One address is a plain button; more
 * addresses (staging, previews) are a dropdown with the main site first.
 */
export function ReviewLinksMenu({ projectId, urls, size = 'md' }: { projectId: string; urls: string[]; size?: 'sm' | 'md' }) {
    const [mainUrl] = urls;
    if (!mainUrl)
        return null;

    // Not links: Next.js would prefetch them, and a review link redirects to the site with a
    // single-use code (app/review), which must only be minted when someone opens it
    const open = (url: string) => window.open(KnownPageLinks.projectReview(projectId, url), '_blank', 'noopener');

    if (urls.length === 1) {
        return (
            <Button
                variant="outlined"
                size={size}
                endDecorator={<ExternalLink className="size-4" />}
                onClick={() => open(mainUrl)}>
                Open review
            </Button>
        );
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outlined" size={size} endDecorator={<ExpandDown className="size-4" />}>
                    Open review
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[min(24rem,calc(100vw-2rem))]">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Review links</DropdownMenuLabel>
                {urls.map((url, index) => (
                    <DropdownMenuItem
                        key={url}
                        onSelect={() => open(url)}
                        endDecorator={<ExternalLink className="size-4 shrink-0" />}>
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate font-mono text-[13px]">{displayUrl(url)}</span>
                            {index === 0 && <span className="text-xs text-muted-foreground">Main site</span>}
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
