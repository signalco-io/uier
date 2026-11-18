import type { Metadata } from 'next';
import { ProjectSettingsNav } from '@/src/components/app/projects/ProjectSettingsNav';

export const metadata: Metadata = {
    referrer: 'same-origin'
};

/**
 * A project's settings: the section links (`ProjectSettingsNav`) beside the chosen section. The layout reads
 * nothing, so it has no boundary of its own and its links never wait for a section; each page under it loads and
 * authorizes its own project (`settingsContext.ts`).
 */
export default function ProjectSettingsLayout({ children }: LayoutProps<'/app/projects/[projectId]/settings'>) {
    return <ProjectSettingsNav>{children}</ProjectSettingsNav>;
}
