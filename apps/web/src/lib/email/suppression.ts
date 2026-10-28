import type { AppDoc } from '../app/model';
import { getAppStore } from '../app/store';
import { sha256Hex } from '../app/tokens';

export type EmailSuppression = AppDoc & {
    type: 'email-suppression';
    addressHash: string;
    reason: 'Bounced' | 'Suppressed';
};

export const emailAddressHash = (address: string) => sha256Hex(address.trim().toLowerCase());
export const emailSuppressionPk = (hash: string) => `email-reports:${hash}`;

/** A failed read must propagate: neither invitations nor digests may fail open. */
export async function emailSuppression(address: string, store = getAppStore()) {
    const hash = emailAddressHash(address);
    return (await store.get<EmailSuppression>(emailSuppressionPk(hash), 'suppression'))?.doc;
}

/** Only a completed proof of mailbox access clears this; report receipts remain. */
export async function clearEmailSuppression(address: string) {
    await getAppStore().delete(emailSuppressionPk(emailAddressHash(address)), 'suppression');
}
