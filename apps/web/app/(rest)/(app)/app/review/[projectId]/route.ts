import { NextResponse } from 'next/server';
import { KnownPages } from '@/src/knownPages';
import { getAppContext } from '@/src/lib/app/context';
import { reviewTarget } from '@/src/lib/app/review';

export const dynamic = 'force-dynamic';

/**
 * A review link: `/app/review/<project>?url=<page>&comment=<id>`. Checks that the signed-in person
 * may review the project and sends them to the page with the toolbar turned on (`?toolbar-code=`)
 * and signed in.
 */
export async function GET(request: Request, { params }: RouteContext<'/app/review/[projectId]'>) {
    const { projectId } = await params;
    const requestUrl = new URL(request.url);

    const context = await getAppContext();
    if (!context) {
        const signIn = new URL(KnownPages.AppSignIn, request.url);
        signIn.searchParams.set('next', `${requestUrl.pathname}${requestUrl.search}`);
        return NextResponse.redirect(signIn);
    }

    const target = await reviewTarget(context, projectId, requestUrl.searchParams.get('url'), requestUrl.searchParams.get('comment'));
    if (!target)
        return new Response('This project does not exist, or you do not have access to it.', { status: 404 });

    return NextResponse.redirect(target);
}
