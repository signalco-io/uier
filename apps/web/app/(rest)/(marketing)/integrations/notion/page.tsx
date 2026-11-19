import { IntegrationGuide, integrationGuideMetadata } from '../IntegrationGuide';

export const metadata = integrationGuideMetadata('notion');

export default function Page() {
    return <IntegrationGuide provider="notion" />;
}
