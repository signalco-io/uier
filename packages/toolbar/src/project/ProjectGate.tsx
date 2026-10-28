import { createContext, type PropsWithChildren, useContext, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toolbarConfig } from '../config';
import { apiRequest, advanceReviewerRevision, clearReviewerCache, projectViewerQueryKey, required, CommentsApiError, commentsQueryKeyPrefix } from '../hooks/api';
import { activityQueryKey } from '../hooks/useComments';
import { ProjectNotice } from '../components/ProjectNotice';
import { useAnnounce } from '../components/Announcer';
import { clearReviewCode, consumeReviewCode, enableBackgroundSignIn, getReviewToken, setReviewToken } from './projectSession';
import { backgroundSignIn } from './backgroundSession';
import { checkInstallationReady } from './installationCheck';
import { defaultPageStatePolicy, type PageStatePolicy } from '../pageState';

/** GET /api/review/<project> (apps/web/src/lib/review/routes.ts) */
export type ReviewInfo = {
    project: { id: string; name: string; access: 'invited' | 'guests' | 'disabled'; brief?: string; pageState?: PageStatePolicy; environments?: { origin: string; label: string; group?: string }[]; environmentOptions?: { id: string; label: string }[] };
    viewer: { kind: 'member' | 'guest' | 'anonymous'; name?: string; isAdmin?: boolean; draftScope?: string };
    canComment: boolean;
    /** Review link of the project on uier: signs in and comes back (add `url`) */
    signInUrl: string;
};

export const reviewApiUrl = `${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}`;

let reviewCodeExchanged = false;

class ReviewSessionEndedError extends CommentsApiError {
    constructor(readonly signInUrl: string) {
        super('sign_in_required', 'This review session ended.', 401);
    }
}

/**
 * Signs the reviewer in with the review link's single-use code (once), then asks who they are and
 * what the project allows. A stored token that no longer works (access removed) is forgotten.
 */
export async function loadReviewInfo() {
    const code = consumeReviewCode();
    if (code && !reviewCodeExchanged) {
        reviewCodeExchanged = true;
        try {
            const session = await apiRequest<{ token: string }>(`${reviewApiUrl}/session`, { method: 'POST', body: { code } });
            if (session?.token) {
                setReviewToken(session.token);
                enableBackgroundSignIn();
                clearReviewCode();
            }
        } catch (error) {
            if (error instanceof CommentsApiError && error.status >= 400 && error.status < 500 && error.status !== 429 && error.code !== 'bot_detected') clearReviewCode();
            void checkInstallationReady(undefined, error);
            console.warn('uier-toolbar: The review link has expired', error);
        }
    }

    if (!getReviewToken()) await backgroundSignIn();

    let info = required(await apiRequest<ReviewInfo>(reviewApiUrl));
    if (getReviewToken() && info.viewer.kind !== 'member') {
        advanceReviewerRevision();
        setReviewToken(undefined);
        if (await backgroundSignIn()) info = required(await apiRequest<ReviewInfo>(reviewApiUrl));
        if (info.viewer.kind !== 'member')
            throw new ReviewSessionEndedError(info.signInUrl);
    }
    return info;
}

export type ProjectViewer = {
    access?: ReviewInfo['project']['access'];
    brief?: string;
    isMember?: boolean;
    environment?: string;
    currentEnvironment?: string;
    environmentLabel?: string;
    environmentOptions?: { id: string; label: string }[];
    setEnvironment?: (value: string) => void;
    draftScope?: string;
    pageState: PageStatePolicy;
    /** Guests tag their comments with a name; members comment under their account name */
    needsName: boolean;
};

export const ProjectViewerContext = createContext<ProjectViewer>({ needsName: false, pageState: defaultPageStatePolicy });

export function useProjectViewer() {
    return useContext(ProjectViewerContext);
}

function signIn(signInUrl: string) {
    const url = new URL(signInUrl);
    url.searchParams.set('url', window.location.href);
    window.location.assign(url.toString());
}

function UnavailableProjectNotice({ onExitReview }: { onExitReview?: () => void }) {
    const announce = useAnnounce();
    const [uncopiedNote, setUncopiedNote] = useState<string>();
    const copyNote = async () => {
        // Only public script configuration and the page's origin. Never use review info or its URL.
        const code = toolbarConfig.project!;
        const note = [
            "uier can't open this project here.",
            `Site address: ${window.location.origin}`,
            `Project code: ${code}`,
            `Project settings: ${toolbarConfig.apiUrl}/app/projects/${encodeURIComponent(code)}/settings`,
            'Ask a project admin to check the installation and add this address under Site addresses if it belongs to the project.'
        ].join('\n');
        try {
            await navigator.clipboard.writeText(note);
            setUncopiedNote(undefined);
            announce('Note copied');
        } catch {
            setUncopiedNote(note);
        }
    };
    return <ProjectNotice text="uier can't open this project here."
        action={{ label: 'Copy note for the owner', onClick: copyNote }} onExitReview={onExitReview}>
        {uncopiedNote && <label className="mt-2 flex min-w-0 flex-col gap-2 rounded-xl border bg-background p-3 text-sm text-foreground">
            <span>The note could not be copied. Copy it from here:</span>
            <textarea readOnly value={uncopiedNote} onFocus={event => event.currentTarget.select()}
                className="max-h-48 min-h-32 w-full rounded-md border border-input bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>}
    </ProjectNotice>;
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
    const client = useQueryClient();
    const previousScope = useRef<string | undefined>(undefined);
    const { data: info, error, isPending, fetchStatus } = useQuery({
        queryKey: projectViewerQueryKey,
        queryFn: loadReviewInfo,
        staleTime: Infinity,
        refetchOnWindowFocus: 'always',
        refetchOnReconnect: 'always',
        retry: 1
    });
    useEffect(() => {
        void checkInstallationReady(info, error);
        const scope = info?.viewer.draftScope ?? info?.viewer.kind;
        const changed = Boolean(previousScope.current && scope && previousScope.current !== scope);
        if (scope) previousScope.current = scope;
        if (changed || (error instanceof CommentsApiError && [401, 403, 404].includes(error.status)) || (info && !info.canComment)) {
            clearReviewerCache(client);
        }
    }, [client, info, error]);

    if (!navigator.onLine && (error || fetchStatus === 'paused')) {
        return <ProjectNotice text="Check your connection to open this review." onExitReview={onExitReview} />;
    }

    if (isPending) {
        return null;
    }

    if (error instanceof ReviewSessionEndedError)
        return <ProjectNotice text="This review session ended." action={{ label: 'Sign in', onClick: () => signIn(error.signInUrl) }} onExitReview={onExitReview} />;

    if (!info) {
        console.warn('uier-toolbar: The project could not be loaded on this site', error);
        return <UnavailableProjectNotice onExitReview={onExitReview} />;
    }

    if (info.project.access === 'disabled') {
        return <ProjectNotice text="Comments are turned off for this project." onExitReview={onExitReview} />;
    }

    if (!info.canComment) {
        return <ProjectNotice text="Sign in to see and leave comments." action={{ label: 'Sign in', onClick: () => signIn(info.signInUrl) }} onExitReview={onExitReview} />;
    }

    return <ProjectEnvironmentProvider key={info.viewer.draftScope ?? info.viewer.kind} info={info}>{children}</ProjectEnvironmentProvider>;
}

function ProjectEnvironmentProvider({ info, children }: PropsWithChildren<{ info: ReviewInfo }>) {
    const current = info.project.environments?.find(item => item.origin === window.location.origin);
    const options = info.project.environmentOptions ?? [];
    const currentEnvironment = current?.group ? `group:${current.group}` : current ? `origin:${current.origin}` : options[0]?.id;
    const storageKey = `uier:environment:v1:${toolbarConfig.apiUrl}:${info.project.id}:${info.viewer.draftScope ?? info.viewer.kind}`;
    const [saved, setSaved] = useState<string | null>(() => {
        if (new URL(window.location.href).searchParams.has('uier-comment')) return null;
        try { return window.localStorage.getItem(storageKey); } catch { return null; }
    });
    const environment = saved && (['all', 'unknown', 'removed'].includes(saved) || options.some(option => option.id === saved)) ? saved : currentEnvironment;
    const setEnvironment = (value: string) => {
        setSaved(value);
        try { window.localStorage.setItem(storageKey, value); } catch { /* Filter still works for this page. */ }
    };
    return <ProjectViewerContext.Provider value={{
        access: info.project.access, brief: info.project.brief,
        isMember: info.viewer.kind === 'member', draftScope: info.viewer.draftScope,
        needsName: info.viewer.kind !== 'member', pageState: info.project.pageState ?? defaultPageStatePolicy,
        currentEnvironment, environment, environmentLabel: current?.label, environmentOptions: options, setEnvironment
    }}>{children}</ProjectViewerContext.Provider>;
}
