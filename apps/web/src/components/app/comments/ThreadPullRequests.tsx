'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRightIcon, GitPullRequestIcon } from 'lucide-react';
import { Badge } from '@/src/components/ui/badge';
import { threadPullRequestLinks, type PullRequestLink, type PullRequestStatus } from '@/src/lib/comments/pullRequestLinks';
import type { ProjectCommentView } from '@/src/lib/app/projectComments';

const commentPullRequestLinks = (comment: Pick<ProjectCommentView, 'text' | 'deleted' | 'replies'>) =>
    threadPullRequestLinks([{ text: comment.text, deleted: comment.deleted }, ...comment.replies]);

const providers = { github: 'GitHub', gitlab: 'GitLab', 'azure-devops': 'Azure DevOps' };
const labels = { open: 'Open', merged: 'Merged', closed: 'Closed', draft: 'Draft' };

function PullRequestValues({ projectId, commentId, links, revision }: {
    projectId: string; commentId: string; links: PullRequestLink[]; revision: string;
}) {
    const value = useRef<HTMLElement>(null);
    const [states, setStates] = useState<PullRequestStatus[]>([]);
    const source = links.map(link => link.url).join('\n');
    useEffect(() => {
        let cancelled = false;
        let shown = false;
        let busy = false;
        let lastRead = 0;
        const controller = new AbortController();
        const refresh = async () => {
            if (cancelled || busy || !shown || document.visibilityState !== 'visible' || Date.now() - lastRead < 5 * 60_000) return;
            busy = true;
            lastRead = Date.now();
            try {
                const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}/pull-requests`, {
                    cache: 'no-store', credentials: 'same-origin', signal: controller.signal
                });
                const result = response.ok ? await response.json() as PullRequestStatus[] : [];
                if (!cancelled) setStates(result);
            } catch { if (!cancelled) setStates([]); }
            finally { busy = false; }
        };
        // The inbox also mounts a thread hidden by CSS on phones. Only the visible detail can trigger a read.
        const observer = new IntersectionObserver(entries => {
            shown = entries.some(entry => entry.isIntersecting);
            void refresh();
        });
        if (value.current) observer.observe(value.current);
        const timer = setInterval(() => void refresh(), 5 * 60_000);
        document.addEventListener('visibilitychange', refresh);
        return () => { cancelled = true; controller.abort(); observer.disconnect(); clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
    }, [projectId, commentId, source, revision]);
    return (
        <dd ref={value} className="m-0 flex min-h-8 min-w-0 flex-col items-start pointer-coarse:min-h-11" data-pull-request-links>
            {links.map(link => {
                const state = states.find(value => value.url === link.url)?.state;
                const repository = link.provider === 'azure-devops' ? `${link.organization}/${link.project}/${link.repository}` : link.repository;
                return (
                    <div key={link.url} className="flex min-h-8 max-w-full items-center gap-2 pointer-coarse:min-h-11">
                        <a href={link.url} target="_blank" rel="noopener noreferrer"
                            className="-mx-1 inline-flex min-h-8 min-w-0 items-center gap-1 rounded-md px-1 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:min-h-11">
                            <GitPullRequestIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{providers[link.provider]} {repository}{link.provider === 'gitlab' ? ' !' : ' #'}{link.number}</span>
                            <ArrowUpRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                        </a>
                        {state && <Badge variant="outline">{labels[state]}</Badge>}
                    </div>
                );
            })}
        </dd>
    );
}

/** One properties row; no extra control or tab stop in a list/board card. */
export function ThreadPullRequests({ projectId, comment }: { projectId: string; comment: ProjectCommentView }) {
    const links = commentPullRequestLinks(comment);
    if (!links.length) return null;
    return <>
        <dt className="flex h-8 items-center text-muted-foreground pointer-coarse:h-11">Pull requests</dt>
        <PullRequestValues key={`${projectId}:${comment.id}:${links.map(link => link.url).join('\n')}`} projectId={projectId} commentId={comment.id} links={links} revision={comment.revision} />
    </>;
}
