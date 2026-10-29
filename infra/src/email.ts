import { all, output, runtime, type Input } from '@pulumi/pulumi';
import { EventSubscription } from '@pulumi/azure-native/eventgrid/index.js';
import type { ResourceGroup } from '@pulumi/azure-native/resources/index.js';
import {
    CommunicationService,
    Domain,
    DomainManagement,
    EmailService,
    SenderUsername,
    UserEngagementTracking,
    getDomainOutput,
    listCommunicationServiceKeysOutput
} from '@pulumi/azure-native/communication/index.js';
import { dnsRecord } from './cloudflare.js';
import { emailDnsRecord } from './emailDns.js';
import { emailReportsReady } from './emailReportsReady.js';
import { verifyTransactionalEmailDomain } from './emailVerification.js';

// Adapted from signalco infra/packages/pulumi/src/azure/acsEmails.ts.
//
// Retain the protected root/managed domains. Cutover requires four supported Azure states
// and authoritative DMARC, independently of Azure's unsupported DMARC verification state.
export function acsEmail(prefix: string, resourceGroup: ResourceGroup) {
    const emailService = new EmailService(`${prefix}-email-service`, {
        resourceGroupName: resourceGroup.name,
        dataLocation: 'Europe',
        location: 'global',
    }, { protect: true });

    const domain = new Domain(`${prefix}-email-domain`, {
        resourceGroupName: resourceGroup.name,
        emailServiceName: emailService.name,
        // The name of an Azure-managed domain is always `AzureManagedDomain`
        domainName: 'AzureManagedDomain',
        domainManagement: DomainManagement.AzureManaged,
        location: 'global',
        userEngagementTracking: UserEngagementTracking.Disabled,
    }, { protect: true });

    const customerDomain = new Domain(`${prefix}-email-domain-custom`, {
        resourceGroupName: resourceGroup.name,
        emailServiceName: emailService.name,
        domainName: 'uier.io',
        domainManagement: DomainManagement.CustomerManaged,
        location: 'global',
        userEngagementTracking: UserEngagementTracking.Disabled,
    }, { protect: true });
    // Public DNS preflight on 2026-10-28 found no existing apex SPF or _dmarc TXT.
    // Recheck before deployment; import/merge externally managed records rather than duplicating.
    for (const [key, type] of [['domain', 'TXT'], ['sPF', 'TXT'], ['dKIM', 'CNAME'], ['dKIM2', 'CNAME'], ['dMARC', 'TXT']] as const) {
        const record = customerDomain.verificationRecords.apply(records => emailDnsRecord(records, key, type));
        dnsRecord(`${prefix}-email-${key.toLowerCase()}`, record.name, record.value, type, true);
    }

    const transactionalDomain = new Domain(`${prefix}-email-domain-transactional`, {
        resourceGroupName: resourceGroup.name,
        emailServiceName: emailService.name,
        domainName: 'notify.uier.io',
        domainManagement: DomainManagement.CustomerManaged,
        location: 'global',
        userEngagementTracking: UserEngagementTracking.Disabled,
    }, { protect: true });
    // Authoritative preflight on 2026-10-29 found no existing SPF, DKIM or DMARC here.
    // Qualify Azure's relative DKIM owners for the parent uier.io Cloudflare zone.
    for (const [key, type] of [['domain', 'TXT'], ['sPF', 'TXT'], ['dKIM', 'CNAME'], ['dKIM2', 'CNAME'], ['dMARC', 'TXT']] as const) {
        const record = transactionalDomain.verificationRecords.apply(records => emailDnsRecord(records, key, type, 'notify.uier.io'));
        dnsRecord(`${prefix}-email-transactional-${key.toLowerCase()}`, record.name, record.value, type, true);
    }

    const verifiedDomain = getDomainOutput({
        resourceGroupName: resourceGroup.name,
        emailServiceName: emailService.name,
        domainName: 'notify.uier.io',
    }, { dependsOn: [transactionalDomain] }).apply(value => verifyTransactionalEmailDomain(value));
    const transactionalSender = new SenderUsername(`${prefix}-email-transactional-sender`, {
        resourceGroupName: resourceGroup.name,
        emailServiceName: emailService.name,
        domainName: verifiedDomain.fromSenderDomain,
        // This is the domain's existing default username, not an additional mailbox/alias.
        senderUsername: 'donotreply',
        username: 'DoNotReply',
        displayName: 'uier',
    }, {
        protect: true,
        // Azure creates this default resource with the domain. Adopt it before updating its name.
        // Remove the import option once CI has recorded it in the stack.
        import: transactionalDomain.id.apply(id => `${id}/senderUsernames/donotreply`),
    });
    const senderIdentity = output({ domain: verifiedDomain, username: transactionalSender.username,
        displayName: transactionalSender.displayName }).apply(({ domain, username, displayName }) => {
        if (typeof username !== 'string' || username.toLowerCase() !== 'donotreply' || displayName !== 'uier')
            throw new Error('The transactional sender identity was not applied.');
        return { domainId: domain.id, address: `${username}@${domain.fromSenderDomain}` };
    });

    const communicationService = new CommunicationService(`${prefix}-communication-service`, {
        resourceGroupName: resourceGroup.name,
        dataLocation: 'Europe',
        location: 'global',
        linkedDomains: [domain.id, senderIdentity.domainId],
    }, { protect: true });
    // Production workers can read changed Vercel variables before the website redeploys.
    // Make the sender variable wait for the new domain link, retaining the managed sender meanwhile.
    const activeSenderAddress = all([senderIdentity, communicationService.linkedDomains]).apply(([identity, linkedDomains]) => {
        if (!linkedDomains?.some(id => id.toLowerCase() === identity.domainId.toLowerCase()))
            throw new Error('The transactional sender domain is not linked.');
        return identity.address;
    });

    const connectionString = listCommunicationServiceKeysOutput({
        resourceGroupName: resourceGroup.name,
        communicationServiceName: communicationService.name,
    }).apply((keys) => {
        if (!keys.primaryConnectionString)
            throw new Error('Azure Communication Services returned no primary connection string.');
        return keys.primaryConnectionString;
    });

    return {
        connectionString,
        communicationServiceId: communicationService.id,
        senderAddress: activeSenderAddress,
    };
}

/** The receiver and credential were deployed before this subscription's validation handshake. */
export function acsEmailReports(topic: Input<string>, credential: Input<string>) {
    const readyCredential = all([topic, credential]).apply(async ([resolvedTopic, resolvedCredential]) => {
        if (!runtime.isDryRun()) await emailReportsReady(resolvedTopic, resolvedCredential);
        return resolvedCredential;
    });
    return new EventSubscription('uier-email-delivery', {
        eventSubscriptionName: 'uier-email-delivery',
        scope: topic,
        eventDeliverySchema: 'EventGridSchema',
        filter: { includedEventTypes: ['Microsoft.Communication.EmailDeliveryReportReceived'] },
        destination: {
            endpointType: 'WebHook',
            endpointUrl: 'https://uier.io/api/email/reports',
            minimumTlsVersionAllowed: '1.2',
            maxEventsPerBatch: 1,
            preferredBatchSizeInKilobytes: 64,
            deliveryAttributeMappings: [{ type: 'Static', name: 'x-uier-email-report-secret', value: readyCredential, isSecret: true }],
        },
        retryPolicy: { maxDeliveryAttempts: 30, eventTimeToLiveInMinutes: 1440 },
    });
}
