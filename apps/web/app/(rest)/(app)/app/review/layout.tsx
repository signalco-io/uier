import type { PropsWithChildren } from 'react';
import { AppBoundary } from '@/src/components/app/AppBoundary';
import { StatusPageOutline } from '@/src/components/StatusPage';

/** Review links redirect; one that cannot open says so (`not-found.tsx`) in the app's language */
export default function ReviewLayout({ children }: PropsWithChildren) {
    return <AppBoundary fallback={<StatusPageOutline />}>{children}</AppBoundary>;
}
