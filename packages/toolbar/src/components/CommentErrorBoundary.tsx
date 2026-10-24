import { Component, ErrorInfo, PropsWithChildren } from 'react';

type CommentErrorBoundaryState = { failed: boolean };

/**
 * Renders nothing instead of its children when they throw. Wraps every pin, highlight and
 * thread: comments are stored by anonymous visitors (and older toolbars), so one comment that
 * can not be shown must never unmount the rest of the toolbar.
 */
export class CommentErrorBoundary extends Component<PropsWithChildren<{ commentId?: string }>, CommentErrorBoundaryState> {
    state: CommentErrorBoundaryState = { failed: false };

    static getDerivedStateFromError(): CommentErrorBoundaryState {
        return { failed: true };
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        console.warn('uier: Could not show a comment', this.props.commentId ?? '', error, info.componentStack);
    }

    render() {
        return this.state.failed ? null : this.props.children;
    }
}
