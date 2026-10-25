import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

// Every cookie and storage key the site sets. Keep in sync with VISITOR_COOKIE_NAME
// (src/lib/comments/limits.ts), the app's cookies (src/lib/app/session.ts, src/lib/app/context.ts)
// and the toolbar's storage keys (packages/toolbar).

export const metadata: Metadata = {
    title: 'Cookie policy',
    description: `The cookies and the browser storage ${brand.domain} uses, and why.`
};

const items = [
    {
        name: 'uier:draft:v1:<scope>:<item>',
        type: 'Local storage',
        when: 'You start or change a feedback draft',
        purpose: 'Restores unsent text, its anchor, the original text of an edit and a submission identity, scoped to the project, reviewer and page. Images are never stored here. Discard, posting and toolbar sign-out clear relevant drafts.',
        duration: 'Seven days after the last change; expired data is removed when the toolbar next opens'
    },
    {
        name: 'uier:visitor',
        type: 'Local storage',
        when: 'You start a draft on uier.io, or open a project review',
        purpose: 'Keeps a random guest identity stable if a submission response is lost. An existing visitor cookie takes precedence. Toolbar sign-out removes it.',
        duration: 'Until toolbar sign-out or you clear your browser data'
    },
    {
        name: 'uier_visitor',
        type: 'Cookie (first party, HttpOnly)',
        when: 'Your first comment, reply or read acknowledgement',
        purpose: 'Recognises your comments and read state, so only you can resolve or delete your comments. Holds a random token; the server stores only its hash.',
        duration: 'One year'
    },
    {
        name: 'uier_session',
        type: 'Cookie (first party, HttpOnly)',
        when: 'You sign in to the app',
        purpose: 'Keeps you signed in. Holds a signed token with your account id; signing out removes it.',
        duration: '30 days'
    },
    {
        name: 'uier_workspace',
        type: 'Cookie (first party, HttpOnly)',
        when: 'You switch to another workspace in the app',
        purpose: 'Remembers which workspace the app shows.',
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
        name: 'uier:toolbar-position:v1',
        type: 'Local storage',
        when: 'You move the toolbar',
        purpose: 'Remembers its position on this site. Reset toolbar position removes it.',
        duration: 'Until reset or you clear your browser data'
    },
    {
        name: 'uier:panel-side:v1:<panel>',
        type: 'Local storage',
        when: 'You move a panel to the other side',
        purpose: 'Remembers the preferred side for each panel on this site.',
        duration: 'Until you clear your browser data'
    },
    {
        name: 'uier:review and uier:toolbar-collapsed',
        type: 'Session storage',
        when: 'You start a review or collapse the toolbar',
        purpose: 'Keeps the review active and remembers whether page comments are hidden in this tab.',
        duration: 'For the browser tab'
    },
    {
        name: 'theme',
        type: 'Local storage',
        when: 'You switch the theme on the brand page or in the app',
        purpose: 'Remembers light, dark or system.',
        duration: 'Until you clear your browser data'
    }
];

export default function CookiePolicyPage() {
    return (
        <LegalDocument href={KnownPages.LegalCookiePolicy} title="Cookie policy" effective="25 October 2026">
            <p>
                {brand.domain} uses cookies and browser storage for the actions and preferences listed below. None of them is set
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
                All of them are needed for something you chose to do, so we do not ask for consent first.
                The cookies are <code>HttpOnly</code> (scripts on the page cannot read them), <code>Secure</code>
                and <code>SameSite=Lax</code>.
            </p>

            <h2>On sites that use {brand.name}</h2>
            <p>
                When you review a site that embeds the {brand.name} toolbar for a project, the toolbar keeps these keys
                in that site&rsquo;s local storage. They are set only once you open a review link or comment, and the
                toolbar&rsquo;s Sign out removes them.
                Before writing, an empty frame on {brand.domain} verifies your browser with BotID. Its signed
                proof lasts five minutes and is kept only in memory. This needs no third-party cookies.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
                <li><code>uier:review-token:&lt;project&gt;</code>: keeps you signed in to the project on that site (30 days).</li>
                <li><code>uier:visitor</code>: a random id that recognises a guest&rsquo;s comments and read state. Read state is limited to this browser and site; clearing the id starts a new identity.</li>
                <li><code>uier:guest-name</code>: the name a guest comments under.</li>
            </ul>

            <p>
                Drafts, toolbar position and panel-side preferences are also stored on reviewed sites. Drafts expire after seven days; signing out clears that reviewer’s drafts for the project on that site. Signing out removes
                the identity keys listed above; movement preferences remain until you reset them or clear site data.
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
                the <code>uier_visitor</code> cookie and <code>uier:visitor</code> local storage, the server can no longer tell that your earlier comments are
                yours: you will not be able to resolve or delete them, and your next comment starts a new guest
                name. Visitor threads stay public until they expire 90 days after their last change, or until you ask us to
                remove them. Replies to our starter threads stay with the thread unless you delete them or ask us to remove them. If you delete the <code>uier_session</code> cookie, you are signed out of the app.
            </p>

            <h2>Contact</h2>
            <p>
                Questions about this policy: <a href={`mailto:${brand.contact.privacy}`}>{brand.contact.privacy}</a>.
            </p>
        </LegalDocument>
    );
}
