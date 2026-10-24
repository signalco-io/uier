import { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePagePath } from '../hooks/usePagePath';
import { CommentsGlobal } from './CommentsGlobal';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentsGlobalProps } from './@types/Comments';
import { AnnouncerProvider } from './Announcer';
import { DraftsProvider } from '../hooks/useDrafts';
import { toolbarConfig } from '../config';
import { ProjectGate } from '../project/ProjectGate';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 10 * 1000
        }
    }
});

export function CommentsBootstrapper({
    mode,
    review = null,
    rootElement,
    onExitReview
}: CommentsGlobalProps) {
    const path = usePagePath();
    const context = useMemo(() => ({ rootElement, mode, review, path }), [rootElement, mode, review, path]);

    return (
        <CommentsBootstrapperContext.Provider value={context}>
            <QueryClientProvider client={queryClient}>
                <AnnouncerProvider>
                    <DraftsProvider>
                        {toolbarConfig.project ? (
                            // A project's comments: only when the project lets this reviewer comment
                            <ProjectGate onExitReview={onExitReview}>
                                <CommentsGlobal
                                    mode={mode}
                                    review={review}
                                    rootElement={rootElement}
                                    onExitReview={onExitReview} />
                            </ProjectGate>
                        ) : (
                            <CommentsGlobal
                                mode={mode}
                                review={review}
                                rootElement={rootElement}
                                onExitReview={onExitReview} />
                        )}
                    </DraftsProvider>
                </AnnouncerProvider>
            </QueryClientProvider>
        </CommentsBootstrapperContext.Provider>
    );
}
