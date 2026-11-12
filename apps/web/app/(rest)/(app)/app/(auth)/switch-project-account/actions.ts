'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { switchProjectAccountSchema } from './actionSchemas';
import { parseActionInput } from '@/src/lib/app/validation';
import { safeNextPath } from '@/src/lib/app/signIn';
import { projectLinkAccounts } from '@/src/lib/app/projectLinkAccounts';
import { switchBrowserAccount } from '@/src/lib/app/browserAccounts';
import { selectWorkspace } from '@/src/lib/app/workspaceCookie';

export async function switchProjectAccount(form: FormData) {
    const input = parseActionInput(switchProjectAccountSchema, Object.fromEntries(['next', 'userId', 'workspaceId'].map(key => [key, form.get(key)])));
    const next = safeNextPath(input.next);
    const jar = await cookies();
    const choice = (await projectLinkAccounts(jar, next)).find(choice => choice.userId === input.userId && choice.workspaceId === input.workspaceId);
    if (!next || !choice) redirect('/app/projects');
    await switchBrowserAccount(jar, choice.userId);
    await selectWorkspace(choice.workspaceId);
    redirect(next);
}
