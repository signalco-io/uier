import { IntegrationGuide, integrationGuideMetadata } from '../IntegrationGuide';

export const metadata = integrationGuideMetadata('github');

export default function Page() {
    return <IntegrationGuide provider="github" />;
}
