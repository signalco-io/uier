import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

// Every cookie and storage key the site sets. Keep in sync with VISITOR_COOKIE_NAME
// (src/lib/comments/limits.ts) and the toolbar's storage keys (packages/toolbar).

export const metadata: Metadata = {
    title: 'Cookie policy',
    description: `The one cookie and the browser storage ${brand.domain} uses, and why.`
};

const items = [
    {
        name: 'uier_visitor',
        type: 'Cookie (first party, HttpOnly)',
        when: 'Your first comment or reply',
        purpose: 'Recognises your comments, so only you can resolve or delete them. Holds a random token; the server stores only its hash.',
        duration: 'One year'
    },
    {
        name: 'uier:showcase-hint-dismissed',
        type: 'Local storage',
        when: 'You close the “Try uier on this page” hint',
        purpose: 'Keeps the hint closed on your next visit.',
        duration: 'Until you clear your browser data'
    },
    {
        name: 'theme',
        type: 'Local storage',
        when: 'You switch the theme on the brand page',
        purpose: 'Remembers light, dark or system.',
        duration: 'Until you clear your browser data'
    }
];

export default function CookiePolicyPage() {
    return (
        <LegalDocument href={KnownPages.LegalCookiePolicy} title="Cookie policy" effective="24 October 2026">
            <p>
                {brand.domain} uses one cookie and two keys in your browser&rsquo;s local storage. None of them is set
                when you only read the site, and none is used for advertising or to follow you to other sites.
            </p>

            <h2>What we store</h2>
            <ul className="flex flex-col gap-3">
                {items.map(item => (
                    <li key={item.name} className="flex flex-col gap-3 rounded-xl border p-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <code>{item.name}</code>
                            <span className="text-sm text-muted-foreground">{item.type}</span>
                        </div>
                        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[96px_1fr]">
                            <dt className="text-muted-foreground">Set when</dt>
                            <dd>{item.when}</dd>
                            <dt className="text-muted-foreground">Purpose</dt>
                            <dd>{item.purpose}</dd>
                            <dt className="text-muted-foreground">Kept for</dt>
                            <dd>{item.duration}</dd>
                        </dl>
                    </li>
                ))}
            </ul>
            <p>
                All three are needed for something you chose to do, so we do not ask for consent first.
                The <code>uier_visitor</code> cookie is <code>HttpOnly</code> (scripts on the page cannot read
                it), <code>Secure</code> and <code>SameSite=Lax</code>.
            </p>

            <h2>Third parties</h2>
            <p>
                Vercel Web Analytics, which counts page views, and Vercel BotID, which checks that comments come
                from people, set no cookies and store nothing in your browser. No other third party loads on{' '}
                {brand.domain}. The <a href={KnownPages.LegalPrivacyPolicy}>privacy policy</a> explains what they
                process.
            </p>

            <h2>Removing them</h2>
            <p>
                You can delete cookies and site data in your browser settings at any time. If you delete
                the <code>uier_visitor</code> cookie, the server can no longer tell that your earlier comments are
                yours: you will not be able to resolve or delete them, and your next comment starts a new guest
                name. They stay public until they expire 90 days after their last change, or until you ask us to
                remove them.
            </p>

            <h2>Contact</h2>
            <p>
                Questions about this policy: <a href={`mailto:${brand.contact.privacy}`}>{brand.contact.privacy}</a>.
            </p>
        </LegalDocument>
    );
}
