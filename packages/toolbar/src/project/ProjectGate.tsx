import { createContext, type PropsWithChildren, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Close } from '@signalco/ui-icons';
import { toolbarConfig } from '../config';
import { apiRequest, projectViewerQueryKey, required } from '../hooks/api';
import { InkScope } from '../components/InkScope';
import { consumeReviewCode, getReviewToken, setReviewToken } from './projectSession';
import { checkInstallationReady } from './installationCheck';
import { defaultPageStatePolicy, type PageStatePolicy } from '../pageState';

/** GET /api/review/<project> (apps/web/src/lib/review/routes.ts) */
export type ReviewInfo = {
    project: { id: string; name: string; access: 'invited' | 'guests' | 'disabled'; pageState?: PageStatePolicy };
    viewer: { kind: 'member' | 'guest' | 'anonymous'; name?: string; isAdmin?: boolean };
    canComment: boolean;
    /** Review link of the project on uier: signs in and comes back (add `url`) */
    signInUrl: string;
};

export const reviewApiUrl = `${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}`;

let reviewCodeExchanged = false;

/**
 * Signs the reviewer in with the review link's single-use code (once), then asks who they are and
 * what the project allows. A stored token that no longer works (access removed) is forgotten.
 */
async function loadReviewInfo() {
    const code = consumeReviewCode();
    if (code && !reviewCodeExchanged) {
        reviewCodeExchanged = true;
        try {
            const session = await apiRequest<{ token: string }>(`${reviewApiUrl}/session`, { method: 'POST', body: { code } });
            if (session?.token) {
                setReviewToken(session.token);
            }
        } catch (error) {
            void checkInstallationReady(undefined, error);
            console.warn('uier-toolbar: The review link has expired', error);
        }
    }

    const info = required(await apiRequest<ReviewInfo>(reviewApiUrl));
    if (getReviewToken() && info.viewer.kind !== 'member') {
        setReviewToken(undefined);
    }
    return info;
}

export type ProjectViewer = {
    pageState: PageStatePolicy;
    /** Guests tag their comments with a name; members comment under their account name */
    needsName: boolean;
};

export const ProjectViewerContext = createContext<ProjectViewer>({ needsName: false, pageState: defaultPageStatePolicy });

export function useProjectViewer() {
    return useContext(ProjectViewerContext);
}

type ProjectNoticeProps = {
    text: string;
    action?: { label: string; onClick: () => void };
    /** Ends the review (`review` mode), like "Exit review" in the toolbar's options */
    onExitReview?: () => void;
};

/** The pill with a message instead of the toolbar's controls (the review layer is always ink) */
function ProjectNotice({ text, action, onExitReview }: ProjectNoticeProps) {
    const hasControls = Boolean(action || onExitReview);
    return (
        <InkScope>
            <nav aria-label="uier feedback" className="fixed bottom-4 left-1/2 z-[51] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2">
                <div
                    role="group"
                    aria-label="uier feedback toolbar"
                    className={cx(
                        'flex items-center gap-3 rounded-full border bg-background pl-4 text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.16)]',
                        hasControls ? 'py-1 pr-1' : 'py-2.5 pr-4'
                    )}>
                    <p className="m-0 text-sm">{text}</p>
                    {hasControls && (
                        <div className="flex items-center gap-1">
                            {action && (
                                <Button variant="solid" size="sm" className="rounded-full" onClick={action.onClick}>
                                    {action.label}
                                </Button>
                            )}
                            {onExitReview && (
                                <IconButton
                                    variant="plain"
                                    className="rounded-full"
                                    title="Exit review"
                                    aria-label="Exit review"
                                    onClick={onExitReview}>
                                    <Close />
                                </IconButton>
                            )}
                        </div>
                    )}
                </div>
            </nav>
        </InkScope>
    );
}

type ProjectGateProps = PropsWithChildren<{
    /** Ends the review (`review` mode): the pill offers it when the reviewer can't comment */
    onExitReview?: () => void;
}>;

/**
 * A project's toolbar: shows the comments only when the project allows this reviewer to comment.
 * Otherwise the pill says why (comments are off, or the project is for invited people: sign in)
 * and still lets the reviewer exit the review.
 */
export function ProjectGate({ children, onExitReview }: ProjectGateProps) {
    const { data: info, error, isPending } = useQuery({
        queryKey: projectViewerQueryKey,
        queryFn: loadReviewInfo,
        staleTime: Infinity,
        retry: 1
    });
    useEffect(() => { void checkInstallationReady(info, error); }, [info, error]);

    if (isPending) {
        return null;
    }

    if (error || !info) {
        console.warn('uier-toolbar: The project could not be loaded on this site', error);
        return <ProjectNotice text="uier can't open this project here. Check the site addresses in its settings." onExitReview={onExitReview} />;
    }

    if (info.project.access === 'disabled') {
        return <ProjectNotice text="Comments are turned off for this project." onExitReview={onExitReview} />;
    }

    if (!info.canComment) {
        const signIn = () => {
            const url = new URL(info.signInUrl);
            url.searchParams.set('url', window.location.href);
            window.location.assign(url.toString());
        };
        return <ProjectNotice text="Sign in to see and leave comments." action={{ label: 'Sign in', onClick: signIn }} onExitReview={onExitReview} />;
    }

    return (
        <ProjectViewerContext.Provider value={{ needsName: info.viewer.kind !== 'member', pageState: info.project.pageState ?? defaultPageStatePolicy }}>
            {children}
        </ProjectViewerContext.Provider>
    );
}
