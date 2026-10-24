'use client';

import { usePathname } from 'next/navigation';
import { Button } from '@signalco/ui-primitives/Button';

export type AppNavLink = { href: string; label: string };

/** Main app navigation; the current section is marked with `aria-current` */
export function AppNav({ links }: { links: AppNavLink[] }) {
    const pathname = usePathname();
    return (
        <nav aria-label="App" className="flex items-center gap-1 overflow-x-auto">
            {links.map(link => {
                const current = pathname === link.href || pathname.startsWith(`${link.href}/`);
                return (
                    <Button
                        key={link.href}
                        href={link.href}
                        variant={current ? 'soft' : 'plain'}
                        size="sm"
                        aria-current={current ? 'page' : undefined}>
                        {link.label}
                    </Button>
                );
            })}
        </nav>
    );
}
