import { projectLinkName, projectLinkProvider, type ProjectLink } from '@/src/lib/app/projectLinks';
import { ProjectLinkIcon } from './ProjectLinkIcon';

/**
 * The project's links in its header, after the client and who can comment (uier #434): each its service's icon and
 * its label, opening in a new tab. Admins edit them in Settings → General.
 */
export function ProjectLinks({ links }: { links: ProjectLink[] }) {
    return links.map((link, index) => (
        <a key={`${index}:${link.url}`} href={link.url} target="_blank" rel="noopener noreferrer" data-project-link
            className="inline-flex min-w-0 items-center gap-1.5 rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            <ProjectLinkIcon provider={projectLinkProvider(link.url)} />
            <span className="min-w-0 break-words">{projectLinkName(link)}</span>
        </a>
    ));
}
