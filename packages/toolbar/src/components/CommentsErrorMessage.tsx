import { cx } from '@signalco/ui-primitives/cx';
import { CommentsApiError } from '../hooks/api';
import { commentTextMaxLength, destructiveTextClassName } from './@types/Comments';
import type { ToastAction } from './Toaster';
import { messages, useMessages } from '../i18n';

/** "in 30 seconds", "in 5 minutes", "in about an hour" */
export function retryAfterText(seconds: number | undefined) {
    const t = messages();
    if (!seconds) {
        return t.errors.later;
    }

    if (seconds < 60) {
        return t.errors.inSeconds(seconds);
    }

    if (seconds < 3600) {
        return t.errors.inMinutes(Math.ceil(seconds / 60));
    }

    const hours = Math.round(seconds / 3600);
    return hours <= 1 ? t.errors.inAboutAnHour : t.errors.inAboutHours(hours);
}

/**
 * Validation messages of the API name the request field (`"text" is too long ...`). Only the
 * text is something the visitor can fix; anything else is about the spot on the page.
 */
function invalidRequestMessage(message: string | undefined) {
    const t = messages();
    // The API's detail is English: shown as it is, after the toolbar's own words
    if (message && /^"text"/.test(message)) {
        return t.errors.cantSave(message.replace(/^"text"/, t.errors.theText));
    }

    if (message) {
        console.warn('uier:', message);
    }
    return t.errors.cantComment;
}

/** Errors whose message already says the text is kept */
export function errorKeepsText(error: unknown) {
    return error instanceof CommentsApiError && ['conflict', 'sign_in_required', 'comments_disabled'].includes(error.code);
}

/** Friendly, plain text message for errors of the comments API, in the toolbar's language */
export function getCommentsErrorMessage(error: unknown) {
    const t = messages();
    if (error instanceof CommentsApiError) {
        switch (error.code) {
            case 'rate_limited':
                return error.reason === 'page_full'
                    ? t.errors.pageFull(retryAfterText(error.retryAfter))
                    : t.errors.tooFast(retryAfterText(error.retryAfter));
            case 'too_large':
                return t.errors.tooLong(commentTextMaxLength);
            case 'bot_detected':
                return t.errors.botDetected;
            case 'forbidden':
                return t.errors.forbidden;
            case 'conflict':
                return t.errors.conflict;
            case 'sign_in_required':
                return t.errors.signInRequired;
            case 'comments_disabled':
                return t.errors.commentsDisabled;
            case 'not_found':
                return t.errors.notFound;
            case 'invalid_request':
                return invalidRequestMessage(error.message);
            case 'unavailable':
                return t.errors.unavailable;
            case 'network_error':
                return t.errors.network;
        }
    }

    return t.errors.generic;
}

/**
 * View usage, for a limit a signed-in member reached: the account's or the workspace's usage page on uier,
 * which the API names (guests have no account, so they get none)
 */
export function usageAction(error: unknown): ToastAction | undefined {
    return error instanceof CommentsApiError && error.code === 'rate_limited' && error.usageUrl
        ? { label: messages().errors.viewUsage, href: error.usageUrl }
        : undefined;
}

export function CommentsErrorMessage({ error, className }: { error: unknown; className?: string }) {
    // Renders again in a new language
    useMessages();
    if (!error) {
        return null;
    }

    return (
        <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName, className)}>
            {getCommentsErrorMessage(error)}
            <UsageLink error={error} />
        </p>
    );
}

/** View usage after an inline message, when {@link usageAction} has one */
export function UsageLink({ error }: { error: unknown }) {
    const usage = usageAction(error);
    return usage && (
        <>
            {' '}
            <a href={usage.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{usage.label}</a>
        </>
    );
}
