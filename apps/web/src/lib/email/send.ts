import { EmailClient, KnownEmailSendStatus } from '@azure/communication-email';
import { isLocalRuntime } from '../comments/environment';

export type EmailMessage = {
    to: string;
    subject: string;
    /** Plain text version; every email has one */
    text: string;
    html: string;
};

export class EmailNotConfiguredError extends Error {
    constructor() {
        super('Email is not configured (ACS_CONNECTION_STRING, UIER_EMAIL_SENDER).');
        this.name = 'EmailNotConfiguredError';
    }
}

/**
 * Where no email is sent, pages show the links they would have emailed: locally (`next dev`, e2e
 * tests) and on preview deployments, which get no email key (they are behind Vercel authentication
 * and have their own data, so a shown sign-in link only opens preview accounts).
 */
export function showsEmailLinksOnPage() {
    return isLocalRuntime() || process.env.VERCEL_ENV === 'preview';
}

let client: EmailClient | null = null;

function emailClient(connectionString: string) {
    return client = client ?? new EmailClient(connectionString);
}

/**
 * Sends an email through Azure Communication Services (`ACS_CONNECTION_STRING`, sender
 * `UIER_EMAIL_SENDER`, both set by Pulumi for production). Without them, locally and on previews,
 * the email is only logged and the page shows its link instead (`showsEmailLinksOnPage`).
 */
export async function sendEmail(message: EmailMessage) {
    const connectionString = process.env.ACS_CONNECTION_STRING;
    const sender = process.env.UIER_EMAIL_SENDER;
    if (!connectionString || !sender) {
        if (!showsEmailLinksOnPage())
            throw new EmailNotConfiguredError();

        console.info(`[email] Not sent (no email on this deployment): "${message.subject}"`);
        return;
    }

    const poller = await emailClient(connectionString).beginSend({
        senderAddress: sender,
        recipients: { to: [{ address: message.to }] },
        content: {
            subject: message.subject,
            plainText: message.text,
            html: message.html
        }
    });
    const result = await poller.pollUntilDone();
    if (result.status !== KnownEmailSendStatus.Succeeded)
        throw new Error(`Email was not sent (${result.status}): ${result.error?.message ?? 'unknown error'}`);
}
