import { getAppI18n } from '@/src/lib/i18n/server';
import type { PropsWithChildren } from 'react';

export async function generateMetadata() {
    const { t } = await getAppI18n();
    return { title: t('Review link unavailable') };
}

export default function UnavailableReviewLayout({ children }: PropsWithChildren) {
    return children;
}
