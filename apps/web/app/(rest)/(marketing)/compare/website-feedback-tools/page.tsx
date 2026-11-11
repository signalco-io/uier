import { AllToolsPage } from '@/src/components/marketing/comparisons/ComparisonPages';
import { comparisonMetadata } from '@/src/components/marketing/comparisons/content';
import { publicPageMetadata } from '@/src/lib/metadata';

export const metadata = publicPageMetadata('/compare/website-feedback-tools', comparisonMetadata('website-feedback-tools'));

export default function Page() { return <AllToolsPage />; }
