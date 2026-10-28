import { interpolate, type Input } from '@pulumi/pulumi';
import { EventSubscription } from '@pulumi/azure-native/eventgrid/index.js';
import type { ResourceGroup } from '@pulumi/azure-native/resources/index.js';
import {
    CommunicationService,
    Domain,
    DomainManagement,
    EmailService,
    UserEngagementTracking,
    listCommunicationServiceKeysOutput
} from '@pulumi/azure-native/communication/index.js';
import { dnsRecord } from './cloudflare.js';
import { emailDnsRecord } from './emailDns.js';

// Adapted from signalco infra/packages/pulumi/src/azure/acsEmails.ts.
//
// #163/#174 provisioned uier.io and DNS with the Azure-managed sender unchanged.
// Cutover stays blocked until Azure verifies all five records, including DMARC.
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

    const communicationService = new CommunicationService(`${prefix}-communication-service`, {
        resourceGroupName: resourceGroup.name,
        dataLocation: 'Europe',
        location: 'global',
        linkedDomains: [domain.id],
    }, { protect: true });

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
        // The Azure-managed sender stays active until all five custom verification states pass.
        senderAddress: interpolate`DoNotReply@${domain.fromSenderDomain}`,
    };
}

/** The receiver and credential were deployed before this subscription's validation handshake. */
export function acsEmailReports(topic: Input<string>, credential: Input<string>) {
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
            deliveryAttributeMappings: [{ type: 'Static', name: 'x-uier-email-report-secret', value: credential, isSecret: true }],
        },
        retryPolicy: { maxDeliveryAttempts: 30, eventTimeToLiveInMinutes: 1440 },
    });
}
