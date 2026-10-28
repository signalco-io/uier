'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { KnownPageLinks } from '@/src/knownPages';
import { appContextOrThrow } from '@/src/lib/app/context';
import { actionResult, UserFacingError, type ActionState } from '@/src/lib/app/actionResult';
import { requireIntegrationAdmin, IntegrationAccessError } from '@/src/lib/integrations/connection';
import { startIntegrationBackfill } from '@/src/lib/integrations/backfill';
import { disconnectSlack, SlackConnectionError } from '@/src/lib/integrations/slack/connection';
import { SlackApiError } from '@/src/lib/integrations/slack/client';
import { SlackRateWait } from '@/src/lib/integrations/slack/rate';
import { loadSlackChannels, saveSlackDestination, sendSlackTestNotification, setSlackEnabled } from '@/src/lib/integrations/slack/settings';

async function slackResult<T>(run: () => Promise<T>, message?: string) {
    return actionResult(async () => {
        try { return await run(); }
        catch (error) {
            if (error instanceof SlackRateWait) throw new UserFacingError('Slack is waiting for its request limit to reset. Try again later.');
            if (error instanceof IntegrationAccessError) throw new UserFacingError('Only a current workspace admin can manage Slack.');
            if (error instanceof SlackConnectionError || error instanceof SlackApiError) {
                const messages: Record<string, string> = {
                    admin_required: 'Only a current workspace admin can manage Slack.',
                    not_configured: 'Slack is unavailable on this deployment.',
                    channel_unavailable: 'Invite the uier app to an available channel in this Slack workspace, then load channels again.',
                    invalid_channel: 'Choose an available channel.',
                    needs_reconnect: 'Reconnect Slack, then try again.',
                    connection_changed: 'The Slack connection changed. Reload settings and try again.',
                    ratelimited: 'Slack is waiting for its request limit to reset. Try again later.',
                    rate_limited: 'Slack is waiting for its request limit to reset. Try again later.',
                    rate_limit_requires_review: 'Slack’s request limit needs a site administrator’s review before requests can resume.',
                    notification_busy: 'Another Slack operation is still running. Try again later.'
                };
                throw new UserFacingError(messages[error.code] ?? 'Slack could not complete this change. Reconnect or try again.');
            }
            throw error;
        }
    }, message);
}

async function admin(form: FormData) {
    const context = await appContextOrThrow({ admin: true });
    const project = await requireIntegrationAdmin(context, z.string().min(1).max(200).parse(form.get('projectId')));
    return { context, project };
}

export async function loadSlackChannelsAction(_: ActionState<Awaited<ReturnType<typeof loadSlackChannels>>>, form: FormData) {
    return slackResult(async () => {
        const { context, project } = await admin(form);
        return loadSlackChannels(project, context.user.id);
    });
}

export async function saveSlackDestinationAction(_: ActionState, form: FormData) {
    return slackResult(async () => {
        const { context, project } = await admin(form);
        if (form.get('confirmDestination') !== 'true') throw new UserFacingError('Confirm the channel can receive shared feedback.');
        const channelId = z.string().regex(/^[A-Z][A-Z0-9]{2,79}$/, 'Choose an available channel.').parse(form.get('channelId'));
        await saveSlackDestination(project, context.user.id, { channelId, replySummaries: form.get('replySummaries') === 'true',
            statusSummaries: form.get('statusSummaries') === 'true' });
        revalidatePath(KnownPageLinks.projectSettings(project.id));
    }, 'The Slack channel is saved. Notifications are on for new shared feedback.');
}

export async function manageSlackAction(_: ActionState<{ message: string }>, form: FormData) {
    return slackResult(async () => {
        const { context, project } = await admin(form);
        const operation = z.enum(['enable', 'disable', 'disconnect', 'backfill', 'test']).parse(form.get('operation'));
        let message: string;
        if (operation === 'disconnect') {
            await disconnectSlack(project, context.user.id);
            message = 'Slack is disconnected from this project.';
        } else if (operation === 'backfill') {
            if (form.get('confirmBackfill') !== 'true') throw new UserFacingError('Confirm that existing feedback can create channel notifications.');
            const result = await startIntegrationBackfill(project, 'slack', context.user.id);
            message = result.total ? `A backfill of ${result.total} selected threads is queued. This may create channel notifications.`
                : 'There are no eligible threads to backfill.';
        } else if (operation === 'test') {
            await sendSlackTestNotification(project, context.user.id);
            message = 'The test notification was sent to Slack.';
        } else {
            await setSlackEnabled(project, context.user.id, operation === 'enable');
            message = operation === 'enable' ? 'Slack notifications are on.' : 'Slack notifications are off.';
        }
        revalidatePath(KnownPageLinks.projectSettings(project.id));
        return { message };
    });
}
