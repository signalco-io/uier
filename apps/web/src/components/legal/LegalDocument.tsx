import type { PropsWithChildren } from 'react';
import { cx } from '@signalco/ui-primitives/cx';
import { KnownPages } from '../../knownPages';

export const legalDocuments = [
    { href: KnownPages.LegalPrivacyPolicy, label: 'Privacy policy' },
    { href: KnownPages.LegalTermsOfService, label: 'Terms of service' },
    { href: KnownPages.LegalCookiePolicy, label: 'Cookie policy' },
    { href: KnownPages.LegalAcceptableUsePolicy, label: 'Acceptable use policy' },
    { href: KnownPages.LegalSla, label: 'SLA' }
] as const;

type LegalDocumentProps = PropsWithChildren<{
    /** Route of this document, marks it as the current page in the legal navigation */
    href: (typeof legalDocuments)[number]['href'];
    title: string;
    /** Date the current version took effect, e.g. "24 October 2026" */
    effective: string;
}>;

/**
 * A legal document: the legal navigation, the title and effective date, then the text. The text
 * is plain HTML (h2, h3, p, ul without a class, a, code) styled here, so the documents stay easy to
 * read and edit.
 */
export function LegalDocument({ href, title, effective, children }: LegalDocumentProps) {
    return (
        <main className="flex flex-col gap-8 py-10">
            <nav aria-label="Legal documents" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {legalDocuments.map(document => (
                    <a
                        key={document.href}
                        href={document.href}
                        aria-current={document.href === href ? 'page' : undefined}
                        className={cx(
                            'underline-offset-4 hover:text-foreground hover:underline',
                            document.href === href ? 'font-medium text-foreground' : 'text-muted-foreground'
                        )}>
                        {document.label}
                    </a>
                ))}
            </nav>
            <article
                className={cx(
                    'flex max-w-[720px] flex-col gap-4 text-base leading-relaxed',
                    '[&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-snug [&_h2]:tracking-[-0.015em]',
                    '[&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold',
                    '[&_ul:not([class])]:flex [&_ul:not([class])]:list-disc [&_ul:not([class])]:flex-col [&_ul:not([class])]:gap-1.5 [&_ul:not([class])]:pl-5',
                    '[&_a]:font-medium [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 hover:[&_a]:decoration-foreground',
                    '[&_code]:font-mono [&_code]:text-[0.875em]'
                )}>
                <header className="flex flex-col gap-2">
                    <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">{title}</h1>
                    <p className="text-sm text-muted-foreground">Effective {effective}</p>
                </header>
                {children}
            </article>
        </main>
    );
}
