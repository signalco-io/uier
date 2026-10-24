import { useMemo } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePagePath } from '../hooks/usePagePath';
import { CommentsGlobal } from './CommentsGlobal';
import { CommentsBootstrapperContext } from './CommentsBootstrapperContext';
import { CommentsGlobalProps } from './@types/Comments';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 10 * 1000
        }
    }
});

export function CommentsBootstrapper({
    mode,
    reviewParamKey,
    rootElement
}: CommentsGlobalProps) {
    const path = usePagePath();
    const context = useMemo(() => ({ rootElement, mode, path }), [rootElement, mode, path]);

    return (
        <CommentsBootstrapperContext.Provider value={context}>
            <QueryClientProvider client={queryClient}>
                <CommentsGlobal
                    mode={mode}
                    reviewParamKey={reviewParamKey}
                    rootElement={rootElement} />
            </QueryClientProvider>
        </CommentsBootstrapperContext.Provider>
    );
}
