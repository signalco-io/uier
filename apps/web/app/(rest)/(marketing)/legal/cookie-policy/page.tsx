import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

// Every cookie and storage key the site sets. Keep in sync with cookieNames
// (src/lib/cookieNames.ts), the app's cookie options (src/lib/app/session.ts)
// and the toolbar's storage keys (packages/toolbar).

export const metadata: Metadata = {
    title: 'Cookie policy',
    description: `The cookies and the browser storage ${brand.domain} uses, and why.`
};

const items = [
    {
        name: 'uier:environment:v1:<api>:<project>:<reviewer>',
        type: 'Local storage',
        when: 'You choose an environment filter in the project inbox',
        purpose: 'Remembers the selected environment or history view for this project and reviewer on this site. It contains no comment text, image or authentication token.',
        duration: 'Until you clear your browser data'
    },
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
        name: '__Host-uier_visitor',
        type: 'Cookie (first party, HttpOnly)',
        when: 'Your first comment, reply, Mark as read or Mark all as read action',
        purpose: 'Recognises your comments and read state, so only you can resolve or delete your comments. Holds a random token; the server stores only its hash.',
        duration: 'One year'
    },
    {
        name: '__Host-uier_sign_in_request',
        type: 'Cookie (first party, HttpOnly)',
        when: 'You ask for a sign-in email',
        purpose: 'Binds the emailed code to this browser. Holds a signed request id, with no email address or code. A new request replaces it; signing in removes it.',
        duration: 'Until the sign-in request expires, at most 15 minutes'
    },
    {
        name: '__Host-uier_session',
        type: 'Cookie (first party, HttpOnly)',
        when: 'You sign in to the app',
        purpose: 'Keeps you signed in and identifies your feedback on uier.io by your account name, taking precedence over a guest identity. Holds a signed token with your account id; signing out in the app removes it.',
        duration: '30 days'
    },
    {
        name: '__Secure-uier_review_sso',
        type: 'Cookie (HttpOnly, Secure, SameSite=None)',
        when: 'You sign in or visit the signed-in app',
        purpose: 'Lets an empty uier frame sign you into a project on a configured site when your browser allows cross-site cookies. It cannot sign you into the app. The server checks your current project access; signing out of the app removes it.',
        duration: 'Until the app session expires, at most 30 days'
    },
    {
        name: '__Host-uier_workspace',
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
        name: 'uier:hint:v1:<api URL>:<project code>',
        type: 'Local storage (on the reviewed site)',
        when: 'You close the first-run guide or start a comment or feedback',
        purpose: 'Keeps the guide closed for this API and project. Stores only a boolean, with no names, reviewer ids or tokens.',
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
        <LegalDocument href={KnownPages.LegalCookiePolicy} title="Cookie policy" effective="29 October 2026">
            <p>
                {brand.domain} uses cookies and browser storage for the actions and preferences listed below. None of them is set
                when you only read the site, and none is used for advertising or to follow you to other sites.
            </p>

            <p>
                Opening a thread on {brand.domain} without an existing guest identity or session does not create
                one or send an automatic read acknowledgement. Choosing Mark as read or Mark all as read can set
                the visitor cookie below. Existing identified reviewers can acknowledge short opened threads automatically.
                Toolbar fonts are served from the configured {brand.name} API origin, without Google Fonts requests.
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
                and <code>SameSite=Lax</code>, except the separate background sign-in cookie described above,
                which uses <code>SameSite=None</code> and is restricted to the review API.
            </p>

            <p>
                The <code>__Host-</code> prefix restricts these cookies to this host and the whole site.
                The background sign-in cookie uses <code>__Secure-</code> because its path is limited to the review API.
                During the name change, we still read the old, unprefixed names for their original lifetime:
                15 minutes for the sign-in request, 30 days for sign-in and background sign-in, and one year
                for visitor identity and workspace selection, counted from 30 October 2026. New cookies use
                the prefixed names. Plain HTTP local development uses unprefixed names.
            </p>

            <h2>On sites that use {brand.name}</h2>
            <p>
                When you review a site that embeds the {brand.name} toolbar for a project, the toolbar keeps these keys
                in that site&rsquo;s local storage once you open a review link, comment or sign in automatically.
                The toolbar&rsquo;s Sign out removes the identity keys.
                Background sign-in uses an empty frame on {brand.domain} and the separate cookie above to
                check your existing account and project access. Blocked cookies or frames leave the explicit
                sign-in link available. We do not open popups or ask for storage access.
                Before writing, an empty frame on {brand.domain} verifies your browser with BotID. Its signed
                proof lasts five minutes and is kept only in memory. This needs no third-party cookies.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
                <li><code>uier:review-token:&lt;project&gt;</code>: keeps you signed in to the project on that site (30 days).</li>
                <li><code>uier:visitor</code>: a random id that recognises a guest&rsquo;s comments and read state. Read state is limited to this browser and site; clearing the id starts a new identity.</li>
                <li><code>uier:guest-name</code>: the name a guest comments under.</li>
                <li><code>uier:review-code:v1:&lt;api&gt;:&lt;project&gt;</code> (session storage): a pending one-use sign-in code, saved before URL removal so a host redirect cannot lose it. It expires after ten minutes and is cleared after exchange, definitive rejection or toolbar sign-out.</li>
                <li><code>uier:auto-sign-in-disabled:&lt;api&gt;:&lt;project&gt;</code> (local storage): remembers toolbar sign-out until you use an explicit authenticated review link.</li>
                <li><code>uier:review-exited</code> (session storage): prevents automatic reopening after Exit review in this tab, until you use a review link.</li>
            </ul>

            <p>
                Drafts, toolbar position and panel-side preferences are also stored on reviewed sites. Drafts expire after seven days; signing out clears that reviewer’s drafts for the project on that site. Signing out removes
                the identity keys listed above; the automatic sign-in opt-out, movement and environment filter preferences remain until reset or you clear site data.
                Signing out of the app stops future background sign-ins; project review tokens already stored
                on other sites last until they expire or you sign out in those toolbars.
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
                the <code>__Host-uier_visitor</code> cookie and <code>uier:visitor</code> local storage, the server can no longer tell that your earlier comments are
                yours: you will not be able to resolve or delete them, and your next comment starts a new guest
                name. Visitor threads stay public until they expire 90 days after their last change, or until you ask us to
                remove them. Replies to our starter threads stay with the thread unless you delete them or ask us to remove them. If you delete the <code>__Host-uier_session</code> cookie, you are signed out of the app.
            </p>

            <h2>Contact</h2>
            <p>
                Questions about this policy: <a href={`mailto:${brand.contact.privacy}`}>{brand.contact.privacy}</a>.
            </p>
        <p>Selected @mentions in an unsent draft also keep the participant&rsquo;s opaque account id and
                its range in the draft text. They use the same seven-day draft record, reviewer and page scope,
                discard controls and sign-out clearing described above. No email address is added to the draft.</p>
        </LegalDocument>
    );
}
