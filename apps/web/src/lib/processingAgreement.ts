import { brand } from '@uier/brand';
import { KnownPages } from '../knownPages';

export const processingAgreementVersion = '25 November 2026';
export const processingAgreementPath = `${KnownPages.LegalTermsOfService}#data-processing`;

export function processingAgreementEmail(workspaceId: string) {
    const subject = 'Customer data processing agreement';
    const body = [
        'Customer legal name:',
        'Authorised representative and role:',
        `Workspace ID: ${workspaceId}`,
        '',
        `I am authorised to accept the uier data processing agreement dated ${processingAgreementVersion} on behalf of the customer identified above and accept it for this workspace.`,
        new URL(processingAgreementPath, brand.url).href,
        '',
        'Please acknowledge receipt and send a copy of the accepted version.'
    ].join('\r\n');
    return `mailto:${brand.contact.privacy}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
