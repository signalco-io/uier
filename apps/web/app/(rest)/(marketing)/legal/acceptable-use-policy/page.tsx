import type { Metadata } from 'next';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

export const metadata: Metadata = {
    title: 'Acceptable use policy',
    description: `What you may not do with ${brand.domain} and the ${brand.name} toolbar, and how to report abuse.`
};

export default function AcceptableUsePolicyPage() {
    return (
        <LegalDocument href={KnownPages.LegalAcceptableUsePolicy} title="Acceptable use policy" effective="25 October 2026">
            <p>
                Comments on {brand.domain} are public and anonymous, so they only work if people use them in good
                faith. This policy is part of the <a href={KnownPages.LegalTermsOfService}>terms of service</a>.
            </p>

            <h2>Do not post</h2>
            <ul>
                <li>anything illegal, or anything that infringes someone else&rsquo;s rights;</li>
                <li>harassment, threats, hate speech or content that sexualises minors;</li>
                <li>personal information about anyone, including yourself: names, addresses, phone numbers, account details;</li>
                <li>passwords, keys or other secrets;</li>
                <li>spam, advertising or links to malware or scams;</li>
                <li>content that pretends to come from {brand.name}, {brand.parent.name} or someone else.</li>
            </ul>

            <h2>Do not misuse the service</h2>
            <ul>
                <li>Do not post in bulk, automate the browser toolbar or public comments API, or work around rate limits or bot protection. The authenticated MCP connector supports user-directed feedback reads and the replies, status changes and assignments you authorize within its granted scope.</li>
                <li>Do not try to read, change or delete other people&rsquo;s comments in ways the toolbar does not offer.</li>
                <li>Do not overload, probe or attack {brand.domain}. To report a vulnerability, follow the <a href={KnownPages.Security}>security policy</a>.</li>
            </ul>

            <h2>What we do</h2>
            <p>
                We may remove any comment or reply and block requests from anyone who breaks this policy, without
                notice. We may report illegal content to the authorities.
            </p>

            <h2>Report abuse</h2>
            <p>
                Email <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a> with the page address and the
                text of the comment. We remove what breaks this policy.
            </p>
        </LegalDocument>
    );
}
