'use client';

import { Component, lazy, Suspense, type ComponentType, type ReactNode } from 'react';

type DeferredOptions<Props extends object> = {
    loading: ReactNode;
    failed: (retry: () => void) => ReactNode;
    /** Framework-aware SSR preloading for an initially visible feature. */
    initial?: ComponentType<Props>;
};

/** Stable component identity, SSR-capable Suspense and local retry for an interaction-only region. */
export function deferredComponent<Props extends object>(load: () => Promise<{ default: ComponentType<Props> }>, options: DeferredOptions<Props>) {
    let Current = options.initial ?? lazy(load);
    return class DeferredComponent extends Component<Props, { failed: boolean }> {
        state = { failed: false };
        private Content = Current;

        static getDerivedStateFromError() {
            return { failed: true };
        }

        private retry = () => {
            // React.lazy remembers a rejection. A fresh lazy instance lets the chunk loader retry.
            Current = lazy(load);
            this.Content = Current;
            this.setState({ failed: false });
        };

        render() {
            if (this.state.failed) return options.failed(this.retry);
            const Content = this.Content;
            return (
                <Suspense fallback={options.loading}>
                    <Content {...this.props} />
                </Suspense>
            );
        }
    };
}
