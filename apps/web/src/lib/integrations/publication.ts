import { brand } from '@uier/brand';
import type { IntegrationProviderId } from './model';

// Dated publication/activation receipts, not runtime flags or a new provider acceptance claim.
// Update only after recording new evidence in docs/integration-{activation,publication}.md.
export const integrationEvidenceUrl = `${brand.repository}/blob/main/docs/integration-activation.md`;
export const integrationPublicationUrl = `${brand.repository}/blob/main/docs/integration-publication.md`;
export const replySyncQualification = 'Hosted verification of imported replies, edits and deletions is still pending. Reply sync stays off until a project admin enables it; Notion needs comment capabilities and Slack requires a separate reply-access reconnect.';

type Publication = { recordedOn: string; recordedLabel: string; installation: string; verification: string };

export const integrationPublication: Record<IntegrationProviderId, Publication> = {
    github: {
        recordedOn: '2026-10-30', recordedLabel: '30 October 2026',
        installation: 'The public GitHub App can be installed from project settings. A Marketplace listing is still a draft, not an approved listing.',
        verification: 'Controlled production checks cover issue creation, updates, outbound discussion, status and shared-to-private cleanup. They do not certify every customer repository or the later reply-import workflow.'
    },
    linear: {
        recordedOn: '2026-10-30', recordedLabel: '30 October 2026',
        installation: 'Public OAuth installation is available from project settings. Directory submission is on hold because its formal-company criterion is not met.',
        verification: 'Controlled production checks cover issue creation, updates, screenshots, refresh and shared-to-private cleanup. They do not certify every customer workspace or the later reply-import workflow.'
    },
    notion: {
        recordedOn: '2026-11-02', recordedLabel: '2 November 2026',
        installation: 'The public connection is installable. Its directory listing was submitted on 30 October; approval and publication are not recorded.',
        verification: 'Controlled production checks cover pages, mapped properties, screenshots, refresh and shared-to-private cleanup. The added read/insert comment permissions were verified separately; they do not prove reply import.'
    },
    'azure-devops': {
        recordedOn: '2026-10-31', recordedLabel: '31 October 2026',
        installation: 'A multitenant Microsoft Entra application is registered and its production credentials are deployed. Publisher verification has not been recorded.',
        verification: 'Hosted user consent, project settings, token refresh and real work-item delivery are still pending verification. Registration and a successful client-credential check do not establish that end-to-end workflow.'
    },
    slack: {
        recordedOn: '2026-11-02', recordedLabel: '2 November 2026',
        installation: 'Public unlisted installation is enabled. The app has not been submitted to Slack Marketplace.',
        verification: 'Controlled production checks cover bounded notifications, status/reply-count summaries and shared-to-private cleanup. The first expiry-driven token refresh and later reply-import workflow remain unverified.'
    }
};
