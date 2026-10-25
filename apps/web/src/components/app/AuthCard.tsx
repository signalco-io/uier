import type { ReactNode } from 'react';
import { CardContent, CardDescription, CardHeader } from '@/src/components/ui/card';

/** The heading of a signed-out page's card (the page's `h1`) and what goes under it */
export function AuthCard({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
    return (
        <>
            <CardHeader>
                <h1 className="m-0 text-xl leading-7 font-semibold tracking-[-0.015em]">{title}</h1>
                {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            {children && <CardContent>{children}</CardContent>}
        </>
    );
}
