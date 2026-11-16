'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { ArrowUpRightIcon, LinkIcon } from 'lucide-react';
import type { ExternalFeedbackLink } from '@uier/toolbar/feedback-context';
import { integrationLogos } from '../integrations/IntegrationLogo';
import { integrationLabels } from './commentLabels';

/** The provider's own mark at 14 px without its tile (BRAND.md: never recoloured); Lucide's link icon for any other */
function IntegrationMark({ provider }: { provider: string }) {
    const logo = Object.hasOwn(integrationLogos, provider) ? integrationLogos[provider as keyof typeof integrationLogos] : undefined;
    if (!logo) return <LinkIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />;
    return (
        <svg aria-hidden="true" data-integration-mark={provider} viewBox={logo.viewBox} className="size-3.5 shrink-0 text-foreground" focusable="false">
            {logo.paths.map(path => <path key={path.d} d={path.d} fill={path.fill ?? 'currentColor'} />)}
        </svg>
    );
}

/**
 * The Integrations row of the thread's details, right below Pull requests: one "Open in Slack" link per connected
 * service the thread was sent to, each with the service's mark (the loading shell draws it inside its `inert` details).
 */
export function ThreadIntegrationLinks({ links }: { links?: ExternalFeedbackLink[] }) {
    const { t } = useAppI18n();
    if (!links?.length) return null;
    return <>
        <dt className="flex h-8 items-center text-muted-foreground pointer-coarse:h-11">{t("Integrations")}</dt>
        <dd className="m-0 flex min-h-8 min-w-0 flex-col items-start pointer-coarse:min-h-11" data-integration-links>
            {links.map(link => (
                <div key={link.provider} className="flex min-h-8 max-w-full items-center pointer-coarse:min-h-11">
                    <a href={link.url} target="_blank" rel="noopener noreferrer"
                        className="-mx-1 inline-flex min-h-8 min-w-0 items-center gap-1 rounded-md px-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11">
                        <IntegrationMark provider={link.provider} />
                        <span className="truncate">{t("Open in ")}{integrationLabels[link.provider] ?? link.provider}</span>
                        <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    </a>
                </div>
            ))}
        </dd>
    </>;
}
