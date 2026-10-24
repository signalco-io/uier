import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

export const metadata: Metadata = {
    title: 'Terms of service',
    description: `The terms for using ${brand.domain} and leaving comments with the ${brand.name} toolbar.`
};

export default function TermsOfServicePage() {
    return (
        <LegalDocument href={KnownPages.LegalTermsOfService} title="Terms of service" effective="24 October 2026">
            <p>
                These terms apply when you use {brand.domain}, including leaving comments with the {brand.name}{' '}
                toolbar. {brand.name} is a {brand.parent.name} project; in these terms &ldquo;we&rdquo; means{' '}
                {brand.parent.name}. By using the site you agree to these terms. If you do not agree, do not use it.
            </p>

            <h2>The service</h2>
            <p>
                {brand.domain} shows what {brand.name} is and runs the {brand.name} toolbar on its own pages. Anyone
                can leave comments there without an account. Using {brand.name} on other websites is not available
                yet; when it is, these terms will cover it.
            </p>

            <h2>Price</h2>
            <p>
                {brand.name} is free. Every feature available today is free and will stay free forever. If we
                introduce pricing, it will apply only to new features users want.
            </p>

            <h2>Your comments</h2>
            <ul>
                <li>Comments are public: anyone who opens the page can read them and reply.</li>
                <li>You are responsible for what you post. Do not post personal information, secrets or anything you do not have the right to share.</li>
                <li>
                    You keep the rights to your comments. You allow us to store them, show them to visitors of the
                    page and remove them, for as long as they exist on {brand.domain}.
                </li>
                <li>Comments are deleted automatically 90 days after their last change. You can delete your own earlier.</li>
            </ul>

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
