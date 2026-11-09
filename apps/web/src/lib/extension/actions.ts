'use server';

import { redirect } from 'next/navigation';
import { actionResult, UserFacingError } from '../app/actionResult';
import { appContextOrThrow } from '../app/context';
import { parseActionInput } from '../app/validation';
import { extensionApprovalActionSchema } from './actionSchemas';
import { issueExtensionCode } from './auth';

/** Consent is for the account shown on the page, even if another tab changes the session. */
export async function approveExtensionAction(expectedUserId: string, authorization: unknown) {
    return actionResult(async () => {
        const input = parseActionInput(extensionApprovalActionSchema, { expectedUserId, authorization });
        const context = await appContextOrThrow();
        if (context.user.id !== input.expectedUserId)
            throw new UserFacingError('Your active account changed. Reload this page and try again.');
        redirect(await issueExtensionCode(context.user.id, input.authorization));
    });
}
