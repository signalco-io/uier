import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

// Describes what the site and the comments API actually do (apps/web/src/lib/comments, README
// "Comments API"). Change this page when what is collected, where it is stored or for how long changes.

export const metadata: Metadata = {
    title: 'Privacy policy',
    description: `What ${brand.domain} collects, why, where it is stored and for how long.`
};

export default function PrivacyPolicyPage() {
    return (
        <LegalDocument href={KnownPages.LegalPrivacyPolicy} title="Privacy policy" effective="24 October 2026">
            <p>
                This policy explains what {brand.domain} collects, why, where it is stored and for how long.
                {' '}{brand.name} is a {brand.parent.name} project: {brand.parent.name} runs {brand.domain} and is
                responsible for the data described here (&ldquo;we&rdquo;).
            </p>

            <h2>In short</h2>
            <ul>
                <li>Reading the site sets no cookies and stores nothing in your browser.</li>
                <li>Comments you leave with the toolbar are public. Anyone who opens the page can read them.</li>
                <li>Comments are deleted automatically 90 days after their last change.</li>
                <li>We do not ask for your name or email address, show ads, sell data or follow you to other sites.</li>
            </ul>

            <h2>What we collect</h2>
            <h3>Comments and replies</h3>
            <p>When you post a comment or a reply with the toolbar, we store:</p>
            <ul>
                <li>the text you write and, for a comment on selected text, the words you selected;</li>
                <li>the page it belongs to (domain and path, without the query string) and where on the page it is pinned;</li>
                <li>when it was posted;</li>
                <li>
                    details about the device it came from: its size (desktop, tablet or mobile), the window
                    size, the pixel ratio, the browser name and version, and the operating system;
                </li>
                <li>an author id: a hash of the random token in your <code>uier_visitor</code> cookie.</li>
            </ul>
            <p>
                Other visitors see the text, the time, the device size and a guest name such as
                &ldquo;Guest 3F2A&rdquo;, derived from the author id. They never see the author id, your browser,
                operating system or window size. Comments are public, so do not put personal information in them.
            </p>

            <h3>The visitor cookie</h3>
            <p>
                Your first comment or reply sets the <code>uier_visitor</code> cookie. It holds a random token that
                lets the server recognise your comments, so only you can resolve or delete them. We store a hash of
                the token, never the token itself. The <a href={KnownPages.LegalCookiePolicy}>cookie policy</a> has
                the details.
            </p>

            <h3>Rate limits and bot protection</h3>
            <p>
                To stop spam we count new comments and replies per visitor and per IP address (an IPv4 address,
                or the /64 network of an IPv6 address), and new comments per page. A counter is stored under a keyed hash, not under
                the address itself, and is deleted shortly after its time window ends: after about an hour, or
                about a day for the count per page. Comments never contain your IP address.
            </p>
            <p>
                Requests that post, change or delete comments are checked by Vercel BotID, which runs a challenge
                in your browser and inspects the request to tell people from bots.
            </p>

            <h3>Analytics</h3>
            <p>
                We count page views with Vercel Web Analytics. It uses no cookies and stores nothing in your
                browser. Vercel discards the hash it uses to recognise a visit after 24 hours, and we only see
                totals: pages, referrers, countries, browsers, operating systems and device types.
            </p>

            <h3>Request logs</h3>
            <p>
                Like any website, our hosting provider receives the usual request details (IP address, browser
                user agent, the address requested) to deliver the site, and keeps them in short-lived logs.
            </p>

            <h2>Why we use it</h2>
            <ul>
                <li>
                    To post your comments and show them to other visitors, as you asked by posting them: the
                    performance of the service you use (Article 6(1)(b) GDPR).
                </li>
                <li>
                    To protect {brand.name} from spam and abuse with rate limits, bot protection and request logs:
                    our legitimate interest in a safe service (Article 6(1)(f) GDPR).
                </li>
                <li>
                    To understand how the site is used, in totals only: our legitimate interest in improving it
                    (Article 6(1)(f) GDPR).
                </li>
            </ul>

            <h2>Where it is stored and who processes it</h2>
            <ul>
                <li>Comments and rate-limit counters: Microsoft Azure Cosmos DB in the West Europe region (the Netherlands).</li>
                <li>
                    Hosting, analytics and bot protection: Vercel. The server code runs in Dublin, Ireland; pages
                    are delivered from Vercel&rsquo;s global network.
                </li>
                <li>DNS: Cloudflare answers DNS queries for {brand.domain}. It does not see the pages you visit.</li>
            </ul>
            <p>
                These providers process the data on our behalf. Microsoft and Vercel are US companies; where data
                leaves the European Economic Area, it is protected by the safeguards in their data processing
                terms, such as the European Commission&rsquo;s standard contractual clauses. We share data with no
                one else unless the law requires it.
            </p>

            <h2>How long we keep it</h2>
            <ul>
                <li>Comments and replies: 90 days after their last change, then they are deleted automatically. You can delete your own earlier in the toolbar.</li>
                <li>Rate-limit counters: about an hour, or about a day for the count per page.</li>
                <li>The <code>uier_visitor</code> cookie: one year after it is set.</li>
                <li>Analytics: Vercel discards the visit hash after 24 hours; the totals remain.</li>
            </ul>

            <h2>Your rights</h2>
            <p>
                You can ask us for a copy of your data, to correct or delete it, to restrict or object to how we use
                it, and to receive it in a portable format. You can delete your own comments and replies with the
                toolbar at any time. For anything else, email <a href={`mailto:${brand.contact.privacy}`}>{brand.contact.privacy}</a>.
                Comments are anonymous, so tell us the page and the comment you mean: we have no other way to link
                a comment to you.
            </p>
            <p>You can also complain to the data protection authority where you live or work.</p>

            <h2>Children</h2>
            <p>{brand.domain} is not meant for children under 16.</p>

            <h2>Changes</h2>
            <p>
                When what we collect, where we store it or how long we keep it changes, we update this page and
                the date at the top.
            </p>

            <h2>Contact</h2>
            <p>
                Privacy requests: <a href={`mailto:${brand.contact.privacy}`}>{brand.contact.privacy}</a>.
                Anything else: <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a>.
            </p>
        </LegalDocument>
    );
}
