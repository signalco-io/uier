import { notFound } from 'next/navigation';

export const metadata = { title: 'Review link unavailable' };

export default function UnavailableReviewPage() {
    notFound();
}
