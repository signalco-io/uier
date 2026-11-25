import { publicPageMetadata } from '@/src/lib/metadata';
import { brand } from '@uier/brand';
import { LegalDocument } from '../../../../../src/components/legal/LegalDocument';
import { KnownPages } from '../../../../../src/knownPages';

// No service commitments have been approved for uier. Do not add uptime targets, response times or
// credits here before they are decided and the product can back them.

export const metadata = publicPageMetadata('/legal/sla', {
    title: 'Service level agreement',
    description: `${brand.name} is free and has no service level agreement: no uptime, response time or support commitments.`
});

export default function SlaPage() {
    return (
        <LegalDocument href={KnownPages.LegalSla} title="Service level agreement" effective="25 November 2026">
            <p>
                {brand.name} has no service level agreement. It is free and provided as is, so we make no
                commitments about:
            </p>
            <ul>
                <li>availability or uptime;</li>
                <li>response or resolution times for problems or questions;</li>
                <li>keeping threads indefinitely. Feedback on uier&rsquo;s own projects expires 90 days after its last change, apart from starter threads and their replies. Customer project feedback stays until deleted;</li>
                <li>advance notice of maintenance or changes.</li>
            </ul>
            <p>We do not offer service credits for downtime. Mandatory legal rights and the commitments in the <a href={`${KnownPages.LegalTermsOfService}#data-processing`}>data processing agreement</a> still apply.</p>

            <h2>What you can expect</h2>
            <ul>
                <li>Every feature available today stays free.</li>
                <li>Problems can be reported in <a href={brand.issues}>GitHub issues</a>, where fixes are discussed in the open.</li>
                <li>Security problems can be reported privately, as described on the <a href={KnownPages.Security}>security page</a>.</li>
            </ul>
            <p>
                If that changes, this page will say so. Until then the{' '}
                <a href={KnownPages.LegalTermsOfService}>terms of service</a> apply, including their warranty and
                liability sections.
            </p>
        </LegalDocument>
    );
}
