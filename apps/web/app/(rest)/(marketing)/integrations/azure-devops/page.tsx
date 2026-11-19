import { IntegrationGuide, integrationGuideMetadata } from '../IntegrationGuide';

export const metadata = integrationGuideMetadata('azure-devops');

export default function Page() {
    return <IntegrationGuide provider="azure-devops" />;
}
