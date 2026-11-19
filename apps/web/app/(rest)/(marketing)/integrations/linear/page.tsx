import { IntegrationGuide, integrationGuideMetadata } from '../IntegrationGuide';

export const metadata = integrationGuideMetadata('linear');

export default function Page() {
    return <IntegrationGuide provider="linear" />;
}
