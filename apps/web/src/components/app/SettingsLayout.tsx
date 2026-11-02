import type { ReactNode } from 'react';
import { LinkTabs, type LinkTab } from './LinkTabs';

/** A section of settings that is its own page; the first has no `section` (it is the settings page itself) */
export type SettingsSection<Section extends string> = { section?: Section; label: string };

/** The tabs of settings sections: a section is also current on the pages below it */
export function settingsTabs<Section extends string>(sections: SettingsSection<Section>[], href: (section?: Section) => string): LinkTab[] {
    return sections.map(({ section, label }) => ({ label, href: href(section), nested: Boolean(section) }));
}

/**
 * Settings in sections, each its own page (a project's settings, the account): the sections beside the
 * chosen one, above it on small screens. `heading` names the settings for screen readers when the
 * page title does not.
 */
export function SettingsLayout({ tabs, label, heading, children }: {
    tabs: LinkTab[];
    /** The name of the sections' navigation */
    label: string;
    heading?: string;
    children: ReactNode;
}) {
    return (
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
            {heading && <h2 className="sr-only">{heading}</h2>}
            <LinkTabs tabs={tabs} label={label} variant="side" match="path" className="md:sticky md:top-6 md:w-44 md:shrink-0" />
            <div className="flex max-w-3xl min-w-0 flex-1 flex-col gap-6">
                {children}
            </div>
        </div>
    );
}
