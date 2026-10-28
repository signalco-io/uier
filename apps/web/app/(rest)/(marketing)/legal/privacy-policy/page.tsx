import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

// Describes what the site, the comments API and the app actually do (apps/web/src/lib/comments,
// apps/web/src/lib/app, README "Comments API" and "The app"). Change this page when what is collected,
// where it is stored or for how long changes.

export const metadata: Metadata = {
    title: 'Privacy policy',
    description: `What ${brand.domain} collects, why, where it is stored and for how long.`
};

export default function PrivacyPolicyPage() {
    return (
        <LegalDocument href={KnownPages.LegalPrivacyPolicy} title="Privacy policy" effective="28 October 2026">
            <p>
                This policy explains what {brand.domain} collects, why, where it is stored and for how long.
                {' '}{brand.name} is a {brand.parent.name} project: {brand.parent.name} runs {brand.domain} and is
                responsible for the data described here (&ldquo;we&rdquo;).
            </p>

            <h2>In short</h2>
            <ul>
                <li>Reading the site sets no cookies and stores nothing in your browser.</li>
                <li>Comments you leave with the toolbar on {brand.domain} are public. Anyone who opens the page can read them.</li>
                <li>Visitor threads are deleted automatically 90 days after their last change. Our starter threads and their replies stay until we remove them.</li>
                <li>
                    Comments in a project, on a site that uses {brand.name}, are visible only to the people the
                    project allows, and stay until they are deleted.
                </li>
                <li>
                    Commenting on {brand.domain} needs no account. If you sign in to the {brand.name} app, we store your
                    email address and name to sign you in and show who you work with.
                </li>
                <li>We do not show ads, sell data or follow you to other sites.</li>
            </ul>

            <h2>What we collect</h2>
            <h3>Comments and replies</h3>
            <p>When you post a comment or a reply with the toolbar, we store:</p>
            <ul>
                <li>the text you write and, for a comment on selected text, the words you selected;</li>
                <li>
                    the page it belongs to and where it is pinned. By default this is the domain and path. A project
                    owner can additionally choose non-sensitive query fields and hash routes that identify a view.
                    Tracking, review activation and recognized credential fields are excluded; unapproved query fields are not stored.
                </li>
                <li>
                    if you or an allowed editor reattach a comment, the new position, original and immediately
                    previous anchors (including selected text), last change time and change count. This context
                    follows the comment&rsquo;s visibility and retention. Reattachment keeps messages and saved images;
                </li>
                <li>when it was posted or edited, and the time in your browser when feedback capture started;</li>
                <li>
                    details about the device it came from: its size (desktop, tablet or mobile), the window
                    size, the pixel ratio, the browser name and version, and the operating system;
                </li>
                <li>an author id: your account id when signed in on {brand.domain}, otherwise a hash of the random token in your <code>uier_visitor</code> cookie;</li>
                <li>
                    a screenshot of the part of the page the comment is about, when capture succeeds. Capture starts
                    automatically in your browser when you start a comment, rewrite, feedback or bug report. It can
                    include what is visible in that part of the page. The image is sent only when you post the feedback;
                    discarding an unsent comment saves no image. Replies keep the original screenshot. On saved feedback,
                    its author or a workspace admin can supply an uploaded or pasted image, or save a redacted replacement.
                    We read clipboard images only when you choose Paste image or paste an image into saved feedback.
                    Supplied images follow the same visibility and retention rules. The original stays until replacement
                    succeeds, then its stored bytes are overwritten. We expose no image history. Replacement cannot remove
                    copies another person already downloaded. Image editing stays in memory in your browser until saved.
                </li>
            </ul>
            <p>
                Other visitors see the text, the time, the device size, the window size (so a reviewer can see
                the page as you saw it), the screenshot if there is one, and a guest name such as &ldquo;Guest
                3F2A&rdquo;, derived from the author id. If you are signed in on {brand.domain}, comments and replies show your current account name.
                Feedback on app pages is private to its author and the uier team. Public and guest views never expose the author id, browser,
                operating system, pixel ratio or capture-start time. Authorized members of a project can view and copy
                those reproduction details for that project, except the author id. Unsupported browser details are shown
                as unknown. The copied page link contains only the stored page path and any approved view state, with no review tokens. Comments on the public
                site are public, so do not put personal information in them.
            </p>

            <h3>Unsent drafts and retries</h3>
            <p>
                The toolbar stores draft text and anchors in the current site&rsquo;s local storage for seven days
                after the last change, scoped to the project, authorized reviewer, page and item. Edit drafts also
                retain the original message text to detect conflicting edits. Discard, posting and toolbar sign-out
                clear relevant drafts. Expired data is removed when the toolbar next opens. Site scripts can read
                local storage. If storage is unavailable, drafts remain only while the page stays open.
            </p>
            <p>
                Draft images and device details are kept only in memory. Reopening a draft refreshes automatic
                capture from the current page and viewport, without a composer image preview. Nothing is sent
                automatically after reload. The server keeps submission hashes and item ids for 30 days to prevent
                duplicate comments and replies when a response is lost. Receipts contain no message text or images.
            </p>

            <h3>The visitor cookie</h3>
            <p>
                Starting a draft keeps a random visitor token in local storage to recover a lost response.
                Your first comment, reply or read acknowledgement sets the <code>uier_visitor</code> cookie. It holds a random token that
                lets the server recognise your comments and read state, so only you can resolve or delete your comments. We store a hash of
                the token, never the token itself. The <a href={KnownPages.LegalCookiePolicy}>cookie policy</a> has
                the details.
            </p>

            <p>Project feedback keeps its recorded source origin. Removing a site address does not delete its feedback or move it to another site. The inbox environment filter is saved in browser storage until you clear site data; app filters stay in the page URL.</p>
            <h3>Your account in the app</h3>
            <p>When you sign in to the {brand.name} app at {brand.domain}/app, we store:</p>
            <ul>
                <li>your email address, and the name shown with your work (it starts as the part of your email before the @, and you can change it);</li>
                <li>when your account was created;</li>
                <li>your workspace and the projects in it: their names, optional client names, the site addresses you add, their environment labels and explicit alias groups, and their settings.</li>
            </ul>
            <p>
                To sign you in, we email you a link and an eight-digit code. We store only a hash of the link token
                and a keyed hash of the code. Both are deleted when either is used, after five wrong codes, or
                after 15 minutes. A short-lived HttpOnly cookie binds the code to the browser that asked for it.
                A new request replaces this binding; signing in removes it. We count code attempts with hashed
                request counters to limit guessing. Signing in sets the <code>uier_session</code> cookie, which keeps
                you signed in; the <a href={KnownPages.LegalCookiePolicy}>cookie policy</a> has the details. We count
                sign-in emails per address and per IP address to stop abuse, in the same way as comments below.
            </p>
            <p>
                When an admin of a workspace invites you, we store your email address, the role and projects they
                chose, and who invited you, and we email you the invitation link. We store only a hash of the token
                in the link. The invitation is deleted when you accept it, when the admin revokes it, or after 7
                days. Accepting it creates your account if you don&rsquo;t have one yet.
            </p>
            <p>
                Every account automatically joins the uier feedback project as a commenter, so you can review
                uier and find your feedback in the app. No invitation email is sent for this membership. Other
                members can see your display name on public feedback; your email is not included in toolbar
                participant suggestions. Private app feedback remains visible only to its author and the team.
            </p>

            <h3>Comments in projects</h3>
            <p>
                When you comment with the toolbar on a site that uses a {brand.name} project, we store the same
                details as for comments above, and the address of the site you commented on. Members comment
                under their account name, guests under the name they give. Who sees the comments is the
                project&rsquo;s choice: its members, or anyone with its review link. A comment an admin makes
                private is visible only to the project&rsquo;s admins and its author. Members can assign comments
                to eligible members and mark them done. We store the assignee&rsquo;s account id. A selected
                @mention stores the recipient&rsquo;s account id and its range in the message text, so names can
                change without changing the recipient. Unsent selections are kept with the browser-local draft
                for up to seven days and are cleared on discard, submission or sign-out. Only signed-in project members can look up participants;
                suggestions contain names and opaque account ids, never email addresses. Assignments and mentions
                do not invite anyone or change access. Private threads can only target people who can already see
                them. Removed participants appear as former members and cannot receive new assignments or mentions.
            </p>
            <p>
                On that site, the toolbar keeps in the browser&rsquo;s local storage a review token while you are
                signed in to the project, or, as a guest, a random visitor id that recognises your comments and
                the name you gave. Signing out in the toolbar removes them.
            </p>
            <p>
                If you are already signed in to {brand.domain}, an empty frame can authenticate you in the
                background on a configured project site. A separate HttpOnly, Secure cookie authorizes only
                this review handoff; we check the requesting site and your current project membership.
                Browsers that block cross-site cookies or frames keep the explicit sign-in link. We do not
                open a popup or request storage access. Toolbar sign-out disables automatic sign-in on that
                site until you use an authenticated review link. A pending link code is kept in tab storage
                for up to ten minutes to survive the reviewed site&rsquo;s own authentication redirects.
                The <a href={KnownPages.LegalCookiePolicy}>cookie policy</a> describes these keys and controls.
            </p>

            <h3>Read activity</h3>
            <p>
                We store the last activity you have read for each thread, the time you acknowledged it and your
                member or hashed visitor identity. This lets the inbox distinguish unread feedback from open work.
                Reading a thread does not resolve it. Members share their read state wherever they sign in. Guest
                read state belongs to that browser and site; signing out clears that identity. Clearing identity storage, including the public site&rsquo;s
                visitor cookie when present, starts a new identity. The toolbar refreshes comments while it is in the foreground.
            </p>

            <h3>Optional reply notifications</h3>
            <p>
                Authorized project owners and admins receive new feedback by email. Members follow threads they post in and can
                follow or unfollow threads or mute a project. Guests can leave feedback with only a name.
                If a guest separately chooses Email me replies, we store the address with that browser
                identity and thread, and send a confirmation link. The address is used for replies and
                status changes only after confirmation. Pending addresses expire after 24 hours;
                unsubscribing removes the address from the subscription. Signing out of the toolbar does not unsubscribe email.
            </p>
            <p>
                We store notification preferences, activity sequence metadata and delivery records in
                Cosmos DB. We use the same read cursor as the toolbar and app to skip activity you have
                already read. Related activity is batched for five minutes and processed by a scheduled
                GitHub workflow using our existing Azure Communication Services email sender. Emails
                name the actor, action, project and page, with authorized thread links. Comment text is
                excluded by default. Workspace admins can enable short comment excerpts for every
                recipient, including verified guests; commenters can see this project setting.
                Quoted page text, images and reproduction details stay out of these emails.
                Every digest links to unsubscribe or manage notifications. Preferences and delivery
                evidence remain until revoked or the associated data is removed. Delivery records can
                include the recipient address and the exact email while a send is pending or its result is uncertain.
                If excerpts were enabled, a retained failed or uncertain attempt can keep that comment
                text until reconciliation, acceptance, suppression or removal of the record, with no
                automatic expiry. Later edits, deletions or disabling excerpts do not change that retained email.
                Unsubscribe prevents further sends. We do not
                add notification cookies or store guest email addresses in your browser.
            </p>

            <h3>Coding tool access</h3>
            <p>
                You can create a named credential in Account to let a coding tool access selected projects
                and operations as your account. We store its hash, your account and workspace ids, name,
                project selection, scopes and expiry in Cosmos DB. The credential expires after 30 days
                when created in the app and can be revoked immediately. We do not store the credential itself.
                Replies and activity record your identity and the credential’s name and id, so other reviewers
                can recognize changes made through your coding tool. These records stay with the feedback.
                Request counters expire after two minutes. Retry receipts contain hashes and feedback ids
                and expire after 30 days.
            </p>
            <p>
                Only the access you explicitly grant is available, subject to your current membership and
                private feedback permissions. The client you choose receives the feedback and any screenshots
                you authorize; its own terms and retention rules apply to copies it receives. Revocation prevents
                further access but cannot remove copies already received by that client. MCP requests use the
                scoped credential and rate limits instead of the browser’s BotID challenge.
            </p>

            <h3>Rewrite suggestions</h3>
            <p>
                When you ask for rewrite suggestions for selected text, that text and your instruction (if you
                give one) are sent to Anthropic, whose Claude model writes the suggestions. We do not store the
                request; only a suggestion you post is saved, like any comment.
            </p>

            <h3>Rate limits and bot protection</h3>
            <p>
                To stop spam we count new comments and replies per visitor or project member, and new comments per page.
                Project members have higher hourly limits and do not share the IP write limit. Guests, commenters on our
                public feedback project and every writer using the anonymous comments API keep the visitor and IP limits.
                An IP limit counts an IPv4 address or the /64 network of an IPv6 address. MCP replies also count per
                credential and against its owner&rsquo;s reply limit; MCP requests count per account per minute.
            </p>
            <p>
                Rewrite suggestions still count per visitor or reviewer, per IP address, per site or project and across
                the app. Screenshots count per site or project per day. Counters use keyed hashes, without plain-text
                IP addresses, account ids or credential ids. They are deleted shortly after their minute, hour or day
                window ends. Comments never contain your IP address.
            </p>
            <p>
                Browser requests that post, change or delete comments are checked by Vercel BotID, which runs a challenge
                in your browser and inspects the request to tell people from bots.
                On reviewed sites this challenge runs in an empty frame on {brand.domain}. It returns a signed
                proof tied to the reviewed site, project and reviewer, valid for five minutes and kept only
                in the toolbar&rsquo;s memory. It does not need third-party cookies.
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
                    To post your comments and show them to other visitors, as you asked by posting them, and to
                    suggest rewrites when you ask for them: the performance of the service you use (Article 6(1)(b) GDPR).
                </li>
                <li>
                    To sign you in to the app, keep your account, workspace and projects, and send the invitations
                    an admin asks for: the performance of the service you use (Article 6(1)(b) GDPR).
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
                <li>Comments, accounts, projects and rate-limit counters: Microsoft Azure Cosmos DB in the West Europe region (the Netherlands).</li>
                <li>Sign-in, invitation and review notification emails: sent by Microsoft Azure Communication Services, with its data stored in Europe.</li>
                <li>Review delivery: GitHub-hosted workflow runners temporarily process recipient and delivery records. Workflow logs contain delivery ids and failure codes, without recipient addresses, comment text or images.</li>
                <li>
                    Hosting, analytics and bot protection: Vercel. The server code runs in Dublin, Ireland; pages
                    are delivered from Vercel&rsquo;s global network.
                </li>
                <li>Rewrite suggestions: Anthropic receives the selected text and your instruction to write them.</li>
                <li>DNS: Cloudflare answers DNS queries for {brand.domain}. It does not see the pages you visit.</li>
            </ul>
            <p>
                These providers process the data on our behalf. Microsoft, Vercel and Anthropic are US companies; where data
                leaves the European Economic Area, it is protected by the safeguards in their data processing
                terms, such as the European Commission&rsquo;s standard contractual clauses. We share data with no
                one else unless the law requires it.
            </p>

            <h2>How long we keep it</h2>
            <ul>
                <li>Visitor threads: 90 days after their last change, then they are deleted automatically. Our starter threads and their replies do not expire. You can delete your own messages earlier in the toolbar.</li>
                <li>Member read cursors: until removed with the account or project on request. Guest read cursors: one year after the last acknowledgement that advances the cursor.</li>
                <li>Screenshots: as long as their comment, and on {brand.domain} at most 90 days after they were taken. Deleting a comment, or its text, deletes its screenshot.</li>
                <li>Coding tool credentials: until revoked, at most 90 days through the credential service (30 days in the app). Expired hashes and grant metadata are deleted automatically. Attribution stays with the feedback.</li>
                <li>Submission receipts: 30 days. Unsent drafts: seven days in the reviewed site’s browser storage, removed on next use after expiry.</li>
                <li>Rate-limit counters: about an hour, or about a day for the count per page.</li>
                <li>Your account, workspace and projects: until you ask us to delete them.</li>
                <li>Comments in projects: until their author or a project admin deletes them.</li>
                <li>Sign-in links: until you use them, at most 15 minutes.</li>
                <li>Invitations: until they are accepted or revoked, at most 7 days.</li>
                <li>The <code>uier_visitor</code> cookie: one year after it is set. The <code>uier_session</code> cookie: 30 days after you sign in.</li>
                <li>Analytics: Vercel discards the visit hash after 24 hours; the totals remain.</li>
            </ul>

            <h2>Your rights</h2>
            <p>
                You can ask us for a copy of your data, to correct or delete it, to restrict or object to how we use
                it, and to receive it in a portable format. You can delete your own comments and replies with the
                toolbar at any time. For anything else, email <a href={`mailto:${brand.contact.privacy}`}>{brand.contact.privacy}</a>.
                Comments on {brand.domain} are anonymous, so tell us the page and the comment you mean: we have no
                other way to link a comment to you. For your app account, write from the email address you sign in with.
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
