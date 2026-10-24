import type { Metadata } from 'next';
import { PageHeader, Section } from '@/src/components/app/PageHeader';
import { brand } from '@uier/brand';

export const metadata: Metadata = {
    title: 'Billing'
};

// What the app does today; every item here is free (issue #48). Only list what ships.
const included = [
    'Projects for every site you review, with staging and other addresses',
    'Comments pinned to elements and to selected text, with replies',
    'Browser, system and viewport saved with every comment',
    'Comments for invited people only, or guests who give their name',
    'Comment lists and boards with filters, assignees and private comments'
];

export default function BillingPage() {
    return (
        <>
            <PageHeader title="Billing" description="What uier costs, now and later." />
            <div className="flex max-w-2xl flex-col gap-6">
                <Section
                    id="plan"
                    title="Free"
                    description="Your plan">
                    {/* The pricing promise, word for word (BRAND.md; the landing page says the same) */}
                    <p className="m-0 text-base leading-[26px]">{brand.pricing}</p>
                    <p className="m-0 text-sm text-muted-foreground">There is no payment method to add, nothing to upgrade and nothing to cancel.</p>
                </Section>
                <Section id="included" title="Included" description="Everything uier does today.">
                    <ul className="m-0 flex list-none flex-col gap-2 p-0">
                        {included.map(item => (
                            <li key={item} className="flex gap-2 text-sm">
                                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[hsl(var(--brand-success))]" />
                                {item}
                            </li>
                        ))}
                    </ul>
                </Section>
            </div>
        </>
    );
}
