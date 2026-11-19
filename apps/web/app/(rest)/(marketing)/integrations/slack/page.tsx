import { IntegrationGuide, integrationGuideMetadata } from '../IntegrationGuide';

export const metadata = integrationGuideMetadata('slack');

export default function Page() {
    return <IntegrationGuide provider="slack" />;
}
