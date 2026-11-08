import { cookies } from 'next/headers';
import { cookieName, cookieNames } from '../cookieNames';
import { parseProjectOrder } from './projectOrder';

/** New after the cookie migration: read only by its current name (the local HTTP name in development) */
export const PROJECT_ORDER_COOKIE_NAME = cookieName(cookieNames.projectOrder);

/** How this browser lists the sidebar's projects (`saveProjectOrderAction` stores it) */
export async function getProjectOrder() {
    return parseProjectOrder((await cookies()).get(PROJECT_ORDER_COOKIE_NAME)?.value);
}
