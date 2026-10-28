import { interpolate } from '@pulumi/pulumi';
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

// Adapted from signalco infra/packages/pulumi/src/azure/acsEmails.ts.
//
// Stage one provisions uier.io and its DNS while the Azure-managed sender remains linked.
// Linking/cutover is a separate reviewed change after live verification and an in-place preview.
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
        const record = customerDomain.verificationRecords.apply(records => {
            const value = records[key];
            if (!value || value.type.toUpperCase() !== type) throw new Error(`Missing/invalid ACS ${key} verification record.`);
            return value;
        });
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
        // Every Azure-managed domain has the `DoNotReply` sender
        senderAddress: interpolate`DoNotReply@${domain.fromSenderDomain}`,
    };
}
