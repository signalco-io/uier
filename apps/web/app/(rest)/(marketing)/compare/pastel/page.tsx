import { PairComparisonPage } from '@/src/components/marketing/comparisons/ComparisonPages';
import { comparisonMetadata } from '@/src/components/marketing/comparisons/content';
import { publicPageMetadata } from '@/src/lib/metadata';

export const metadata = publicPageMetadata('/compare/pastel', comparisonMetadata('pastel'));

export default function Page() { return <PairComparisonPage slug="pastel" />; }
