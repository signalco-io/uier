import { publicPageMetadata } from '@/src/lib/metadata';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

export const metadata = publicPageMetadata('/legal/terms-of-service', {
    title: 'Terms of service',
    description: `The terms for using ${brand.domain} and leaving comments with the ${brand.name} toolbar.`
});

export default function TermsOfServicePage() {
    return (
        <LegalDocument href={KnownPages.LegalTermsOfService} title="Terms of service" effective="12 November 2026">
            <p>
                These terms apply when you use {brand.domain}, its app, toolbar, browser extension and coding-tool
                connections. {brand.name} is a {brand.parent.name} project; in these terms &ldquo;we&rdquo; means{' '}
                {brand.parent.name}. By using the site you agree to these terms. If you do not agree, do not use it.
            </p>

            <h2>The service</h2>
            <p>
                {brand.name} lets people review live websites and discuss the feedback. You can try it on our
                public pages without an account. Sign in to create a workspace and projects for your own sites,
                invite people or teams, share review links and connect coding tools. Project settings determine
                which sites and reviewers can use the toolbar. Guest access does not require an account when
                the project allows it.
            </p>
            <p>
                Add the toolbar or configure a site only if you have the site owner&rsquo;s authority to do so.
                Workspace admins are responsible for the sites, access settings, invitations and services they
                configure. Make sure you have permission to collect and share the page content and feedback,
                including screenshots, with the reviewers and connected services you choose.
            </p>

            <h2>Price</h2>
            <p>
                {brand.name} is free. {brand.pricing}
            </p>

            <h2>Your comments</h2>
            <ul>
                <li>Guest feedback on our public pages is public. Feedback you leave while signed in to uier is private to you and the uier team.</li>
                <li>In customer projects, the project&rsquo;s access settings control visibility. Private feedback is limited to its author and workspace admins. Keep review links and credentials with the people you intend to give access to.</li>
                <li>You are responsible for what you post. Do not post personal information, secrets or anything you do not have the right to share.</li>
                <li>
                    You keep the rights to your comments. You allow us to store them, show them to visitors of the
                    project or public page and remove them, within the access and retention rules described here.
                </li>
                <li>Feedback in uier&rsquo;s own feedback projects expires 90 days after its last change, whether left as a guest or while signed in. Our starter threads and their replies do not expire. Feedback in customer projects stays until it or its project is deleted; marking it done or archiving it does not delete it.</li>
                <li>You can remove your own messages. Removing a message can leave other people&rsquo;s replies in place. A separate whole-thread deletion removes the discussion; the thread author or a workspace admin can use it where offered. Workspace admins, including the uier team in our feedback projects, can moderate feedback.</li>
            </ul>

            <h2>Removal and outside copies</h2>
            <p>
                A workspace admin can delete a project. You can request account or personal-data removal using
                the contact in our <a href={KnownPages.LegalPrivacyPolicy}>privacy policy</a>. Removing an account
                or someone&rsquo;s project access does not automatically delete all feedback they contributed.
                Cleanup can require retries. Deleted data can remain in backups for up to seven days; copies
                already delivered to reviewers, email, coding tools or connected services follow those
                recipients&rsquo; own retention and removal rules. We cannot promise immediate erasure of every copy.
            </p>

            <h2>Acceptable use</h2>
            <p>
                Follow the <a href={KnownPages.LegalAcceptableUsePolicy}>acceptable use policy</a>. We may remove any
                comment, and block anyone who breaks it, without notice.
            </p>

            <h2>Open source</h2>
            <p>
                The {brand.name} source code is published at <a href={brand.repository}>{brand.repository.replace('https://', '')}</a> under
                its own licenses (AGPL-3.0 and MIT, see <a href={KnownPages.OpenSource}>open source</a>). These terms
                do not limit the rights those licenses give you.
            </p>

            <h2>No warranty</h2>
            <p>
                {brand.domain} is provided free and &ldquo;as is&rdquo;. We do not promise that it will be available,
                fast or free of errors, or that comments will be kept: see the <a href={KnownPages.LegalSla}>SLA</a>.
                To the extent the law allows, we disclaim all warranties, express or implied.
            </p>

            <h2>Liability</h2>
            <p>
                To the extent the law allows, we are not liable for indirect or consequential loss, or for loss of
                data, profit or business, arising from your use of {brand.domain} or from comments posted by others.
                Nothing in these terms limits liability that cannot be limited by law.
            </p>

            <h2>Changes</h2>
            <p>
                We may change these terms. We publish the new version here with a new date at the top; it applies
                from that date. If you keep using the site after a change, the new terms apply to you.
            </p>

            <h2>Law</h2>
            <p>
                These terms are governed by the laws of Croatia. Courts in Croatia have jurisdiction, unless the law
                of the country where you live as a consumer gives you the right to go to court there.
            </p>

            <h2>Contact</h2>
            <p>
                <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a>
            </p>
        </LegalDocument>
    );
}
