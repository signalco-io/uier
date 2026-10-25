import { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePagePath } from '../hooks/usePagePath';
import { CommentsGlobal } from './CommentsGlobal';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentsGlobalProps } from './@types/Comments';
import { AnnouncerProvider } from './Announcer';
import { DraftsProvider } from '../hooks/useDrafts';
import { toolbarConfig } from '../config';
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
    const { pageState } = useProjectViewer();
    const path = usePagePath(pageState);
    const context = useMemo(() => ({ rootElement, mode, review, path }), [rootElement, mode, review, path]);

    return (
        <CommentsBootstrapperContext.Provider value={context}>
            <DraftsProvider>
                <CommentsGlobal key={path} mode={mode} review={review} rootElement={rootElement} onExitReview={onExitReview} />
            </DraftsProvider>
        </CommentsBootstrapperContext.Provider>
    );
}

export function CommentsBootstrapper(props: CommentsGlobalProps) {
    return <QueryClientProvider client={queryClient}>
        <AnnouncerProvider>
            {toolbarConfig.project ? <ProjectGate onExitReview={props.onExitReview}><ReviewLayer {...props} /></ProjectGate> : <ReviewLayer {...props} />}
        </AnnouncerProvider>
    </QueryClientProvider>;
}
