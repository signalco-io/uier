import { cookies } from 'next/headers';
import { cookieName, cookieNames } from '../cookieNames';
import { parseCommentsView } from './commentsViewPreference';

/** Request-scoped, so a full load can render the browser's chosen layout before hydration. */
export async function getCommentsView() {
    return parseCommentsView((await cookies()).get(cookieName(cookieNames.commentsView))?.value);
}
