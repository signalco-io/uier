import { Bar, Loading } from '../loading/outlines';
import { CommentsSection } from '../comments/CommentsSection';
import { ProjectCommentsLoading } from '../comments/ProjectCommentsLoading';
import { PageChecksLoading } from '../pageChecks/PageChecksLoading';
import { InstallLoading } from './InstallLoading';
import { ProjectLoadingHeader, ProjectLoadingPage, ProjectLoadingTabs } from './ProjectLoadingShell';
import { ProjectSettingsLoading } from './ProjectSettingsLoading';

/**
 * A project while its layout loads (uier #344): the layout's own frame with the static shell drawn for real and
 * skeletons only where data goes (uier #439). The header shows the project's favicon and name as the sidebar already
 * has them, over a bar for the rest (`ProjectLoadingHeader`; Open review is in the shell's top bar). The tabs every
 * project has are the real tabs (`ProjectLoadingTabs`). Under them the loading state of the page being opened (`ProjectLoadingPage`): the
 * comments in their region, the page checks, a settings section, or onboarding's install step. As wide as the loaded page: on the comments and
 * the page checks the header is the panel's width less the gutters (`page-wide`, uier #363), like the project layout's.
 */
export function ProjectLoading() {
    return (
        <div className="group/project flex flex-col [--project-tabs:2.5rem]">
            <ProjectLoadingHeader />
            <ProjectLoadingTabs />
            <div className="flex flex-col gap-6 pt-6">
                <ProjectLoadingPage
                    comments={<CommentsSection><ProjectCommentsLoading /></CommentsSection>}
                    files={<Loading label="Loading files"><Bar className="h-40 w-full rounded-xl" /></Loading>}
                    pageChecks={<PageChecksLoading />}
                    settings={<ProjectSettingsLoading />}
                    install={<InstallLoading />} />
            </div>
        </div>
    );
}
