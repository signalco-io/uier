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

// Adapted from signalco infra/packages/pulumi/src/azure/acsEmails.ts.
//
// Azure Communication Services Email with an Azure-managed sender domain (`<id>.azurecomm.net`).
// Unlike a customer-managed domain (uier.io), it needs no DNS records and no manual verification
// before the domain can be linked to the communication service, so a single `pulumi up` gives a
// working sender. Azure-managed domains have low sending limits; switch to a verified uier.io
// domain when the app sends more mail.
export function acsEmail(prefix: string, resourceGroup: ResourceGroup) {
    const emailService = new EmailService(`${prefix}-email-service`, {
        resourceGroupName: resourceGroup.name,
        dataLocation: 'Europe',
        location: 'global',
    });

    const domain = new Domain(`${prefix}-email-domain`, {
        resourceGroupName: resourceGroup.name,
        emailServiceName: emailService.name,
        // The name of an Azure-managed domain is always `AzureManagedDomain`
        domainName: 'AzureManagedDomain',
        domainManagement: DomainManagement.AzureManaged,
        location: 'global',
        userEngagementTracking: UserEngagementTracking.Disabled,
    });

    const communicationService = new CommunicationService(`${prefix}-communication-service`, {
        resourceGroupName: resourceGroup.name,
        dataLocation: 'Europe',
        location: 'global',
        linkedDomains: [domain.id],
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
        // Every Azure-managed domain has the `DoNotReply` sender
        senderAddress: interpolate`DoNotReply@${domain.fromSenderDomain}`,
    };
}
