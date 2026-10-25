import { useMemo } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { InkScope } from './InkScope';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePagePath } from '../hooks/usePagePath';
import { CommentsGlobal } from './CommentsGlobal';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentsGlobalProps } from './@types/Comments';
import { AnnouncerProvider } from './Announcer';
import { DraftsProvider } from '../hooks/useDrafts';
import { toolbarConfig } from '../config';
import { useVisitor } from '../hooks/useVisitor';
import { ProjectViewerContext } from '../project/ProjectGate';
import { defaultPageStatePolicy } from '../pageState';
import { ProjectGate, useProjectViewer } from '../project/ProjectGate';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 10 * 1000
        }
    }
});

function ReviewLayer({
    mode,
    review = null,
    rootElement,
    onExitReview
}: CommentsGlobalProps) {
    const { pageState, draftScope } = useProjectViewer();
    const path = usePagePath(pageState);
    const context = useMemo(() => ({ rootElement, mode, review, path }), [rootElement, mode, review, path]);

    return (
        <CommentsBootstrapperContext.Provider value={context}>
            <DraftsProvider key={draftScope}>
                <CommentsGlobal key={path} mode={mode} review={review} rootElement={rootElement} onExitReview={onExitReview} />
            </DraftsProvider>
        </CommentsBootstrapperContext.Provider>
    );
}

function PublicReviewLayer(props: CommentsGlobalProps) {
    const { query } = useVisitor();
    // Old unconfigured cross-origin embeds still show their controls and comments load error.
    // No server scope can be read there, so DraftsProvider uses memory only.
    if (new URL(toolbarConfig.apiUrl).origin !== window.location.origin) return <ReviewLayer {...props} />;
    if (!query.data?.draftScope) return query.isError ? (
        <InkScope>
            <div role="status" className="fixed bottom-4 left-1/2 z-[51] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-background p-3 text-foreground">
                <p className="m-0 text-sm">Your reviewer details could not be loaded.</p>
                <Button variant="outlined" size="sm" onClick={() => query.refetch()}>Try again</Button>
            </div>
        </InkScope>
    ) : null;
    return <ProjectViewerContext.Provider value={{ needsName: false, pageState: defaultPageStatePolicy, draftScope: query.data.draftScope }}>
        <ReviewLayer key={query.data.draftScope} {...props} />
    </ProjectViewerContext.Provider>;
}

export function CommentsBootstrapper(props: CommentsGlobalProps) {
    return <QueryClientProvider client={queryClient}>
        <AnnouncerProvider>
            {toolbarConfig.project ? <ProjectGate onExitReview={props.onExitReview}><ReviewLayer {...props} /></ProjectGate> : <PublicReviewLayer {...props} />}
        </AnnouncerProvider>
    </QueryClientProvider>;
}
