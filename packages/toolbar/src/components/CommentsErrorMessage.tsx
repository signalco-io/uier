import { cx } from '@signalco/ui-primitives/cx';
import { CommentsApiError } from '../hooks/useComments';
import { commentTextMaxLength } from './@types/Comments';

function retryAfterText(seconds: number | undefined) {
    if (!seconds) {
        return 'Please wait a bit and try again.';
    }

    if (seconds < 60) {
        return `Please try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
    }

    const minutes = Math.ceil(seconds / 60);
    return `Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/** Friendly, plain text message for errors of the comments API */
export function getCommentsErrorMessage(error: unknown) {
    if (error instanceof CommentsApiError) {
        switch (error.code) {
            case 'rate_limited':
                return `You're sending feedback too quickly. ${retryAfterText(error.retryAfter)}`;
            case 'too_large':
                return `That's too long. Comments can have up to ${commentTextMaxLength} characters.`;
            case 'bot_detected':
                return 'We couldn\'t verify your browser. Reload the page and try again.';
            case 'forbidden':
                return 'Only the author of this comment can do that.';
            case 'not_found':
                return 'This comment no longer exists.';
            case 'invalid_request':
                return error.message
                    ? `This can't be saved: ${error.message}`
                    : 'This can\'t be saved. Check the text and try again.';
            case 'network_error':
                return 'Can\'t reach uier right now. Check your connection and try again.';
        }
    }

    return 'Something went wrong. Please try again.';
}

export function CommentsErrorMessage({ error, className }: { error: unknown; className?: string }) {
    if (!error) {
        return null;
    }

    return (
        <p role="alert" className={cx('m-0 text-sm text-red-300', className)}>
            {getCommentsErrorMessage(error)}
        </p>
    );
}
