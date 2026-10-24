import { cx } from '@signalco/ui-primitives/cx';
import { CommentsApiError } from '../hooks/useComments';
import { commentTextMaxLength, destructiveTextClassName } from './@types/Comments';

/** "in 30 seconds", "in 5 minutes", "in about an hour" */
export function retryAfterText(seconds: number | undefined) {
    if (!seconds) {
        return 'later';
    }

    if (seconds < 60) {
        return `in ${seconds} second${seconds === 1 ? '' : 's'}`;
    }

    if (seconds < 3600) {
        const minutes = Math.ceil(seconds / 60);
        return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
    }

    const hours = Math.round(seconds / 3600);
    return hours <= 1 ? 'in about an hour' : `in about ${hours} hours`;
}

/**
 * Validation messages of the API name the request field (`"text" is too long ...`). Only the
 * text is something the visitor can fix; anything else is about the spot on the page.
 */
function invalidRequestMessage(message: string | undefined) {
    if (message && /^"text"/.test(message)) {
        return `This can't be saved. ${message.replace(/^"text"/, 'The text')}`;
    }

    if (message) {
        console.warn('uier:', message);
    }
    return 'This spot can\'t be commented on. Try selecting text or a different element.';
}

/** Friendly, plain text message for errors of the comments API */
export function getCommentsErrorMessage(error: unknown) {
    if (error instanceof CommentsApiError) {
        switch (error.code) {
            case 'rate_limited':
                return error.reason === 'page_full'
                    ? `This page has reached its comment limit. Try again ${retryAfterText(error.retryAfter)}.`
                    : `You're sending feedback too quickly. Try again ${retryAfterText(error.retryAfter)}.`;
            case 'too_large':
                return `That's too long. Comments can have up to ${commentTextMaxLength} characters.`;
            case 'bot_detected':
                return 'We couldn\'t verify your browser. Reload the page and try again.';
            case 'forbidden':
                return 'Only the author of this comment can do that.';
            case 'not_found':
                return 'This comment no longer exists.';
            case 'invalid_request':
                return invalidRequestMessage(error.message);
            case 'network_error':
                return 'Can\'t reach uier right now. Check your connection and try again.';
        }
    }

    return 'Something went wrong. Try again.';
}

export function CommentsErrorMessage({ error, className }: { error: unknown; className?: string }) {
    if (!error) {
        return null;
    }

    return (
        <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName, className)}>
            {getCommentsErrorMessage(error)}
        </p>
    );
}
