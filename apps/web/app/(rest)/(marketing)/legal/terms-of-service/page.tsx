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
        <LegalDocument href={KnownPages.LegalTermsOfService} title="Terms of service" effective="25 November 2026">
            <p>
                These terms apply when you use {brand.domain}, its app, toolbar, browser extension and coding-tool
                connections. Your agreement is with Aleksandar Toplek, who operates {brand.domain} from
                Croatia as a {brand.parent.name} project. By using the service you agree to these terms.
                If you use it on behalf of an organisation, you must have authority to accept its terms.
                You can reach the operator at <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a>.
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

            <h2 id="data-processing">Data processing agreement</h2>
            <p>
                This agreement forms part of the terms between the customer and Aleksandar Toplek for
                hosted customer projects. It applies when we handle personal data on the customer&rsquo;s
                behalf and takes precedence over conflicting terms about that processing. The customer
                acts as controller or, if it acts for another controller, appoints us as its subprocessor
                with that controller&rsquo;s authority. An authorised representative can also confirm the
                agreement by emailing <a href={`mailto:${brand.contact.privacy}`}>{brand.contact.privacy}</a>{' '}
                with the customer name, workspace and terms version for written acknowledgement.
            </p>
            <h3>What the customer asks us to do</h3>
            <p>
                For the duration of the review service, we host, retrieve, display, transmit and delete
                feedback as instructed. This can include reviewers&rsquo; and invitees&rsquo; names, email addresses,
                guest identifiers, roles and activity, as well as comments, selected text, page addresses,
                browser details, screenshots and recordings. These may also identify people visible on
                the reviewed site or mentioned in a thread. The customer determines the sites, access,
                retention instructions and destinations and is responsible for lawful collection, notices
                and authority to give those instructions. Keep special-category data and criminal-offence
                data out of the service.
            </p>
            <h3>Instructions and security</h3>
            <p>
                We process these data only on documented customer instructions, including for transfers
                outside the EEA. These terms, project settings and authorised requests document those
                instructions. If EU or Member State law requires different processing, we inform the
                customer before acting unless the law prohibits this on important public-interest grounds.
                We immediately tell the customer if we consider an instruction contrary to data protection law.
            </p>
            <p>
                We restrict access to authorised people bound by confidentiality and maintain technical
                and organisational measures appropriate to the risk under GDPR Article 32. These include
                HTTPS, project access checks and restricted storage for capture files. Our{' '}
                <a href={KnownPages.Security}>security page</a> describes the service controls.
            </p>
            <h3>Subprocessors and transfers</h3>
            <p>
                The customer gives general written authorisation to use Microsoft Azure for data storage
                and email, Vercel for hosting and bot protection, GitHub Actions for notification
                processing, and Anthropic for AI features that send project content. See the{' '}
                <a href={`${KnownPages.LegalPrivacyPolicy}#providers`}>provider details</a> for the data
                each receives. We impose the same applicable data protection obligations on subprocessors
                by written contract and remain responsible to the customer for their performance.
                Transfers outside the EEA must comply with GDPR Chapter V.
            </p>
            <p>
                Before adding or replacing a subprocessor, we will email affected workspace admins with
                the provider, purpose and planned start date at least 30 days in advance. The customer may
                object on data protection grounds during that period. We will work with the customer on an
                alternative. If we cannot resolve the objection, the customer may end the affected service
                and request return or deletion before the new provider processes its data.
            </p>
            <h3>Requests, incidents and audits</h3>
            <p>
                We promptly forward rights requests about project data to the customer and assist it,
                using appropriate technical and organisational measures, in answering them. Taking account
                of the processing and the information available to us, we assist with security, breach
                notices, impact assessments and consultation with supervisory authorities under GDPR
                Articles 32–36. If we become aware of a personal data breach affecting customer data, we
                notify the customer without undue delay and provide available details and updates to
                support its response.
            </p>
            <p>
                We provide the information needed to demonstrate compliance with Article 28 and allow and
                contribute to audits, including inspections, by the customer or its mandated auditor.
                Contact <a href={`mailto:${brand.contact.privacy}`}>{brand.contact.privacy}</a> to arrange
                access while protecting the confidentiality of other customers.
            </p>
            <h3>When processing ends</h3>
            <p>
                At the customer&rsquo;s choice, we return or delete all personal data processed on its behalf
                at the end of the service and delete remaining copies unless EU or Member State law requires
                storage. Contact us to arrange return before deleting a project. Deleted data can remain in
                protected backups for up to seven days. If restored, it remains subject to the deletion
                instruction. Copies the customer sent to its own systems or integrations remain under its control.
            </p>

            <h2>Price</h2>
            <p>
                {brand.name} is free. {brand.pricing}
            </p>

            <h2>Your comments</h2>
            <ul>
                <li>Guest feedback on our public pages is public. Feedback you leave while signed in to uier is private to you and the uier team.</li>
                <li>In customer projects, the project&rsquo;s access settings control visibility. Private feedback is limited to its author and workspace admins. Keep review links and credentials with the people you intend to give access to.</li>
                <li>You are responsible for what you post. Keep personal information out of public feedback. In customer projects, share personal data only where you are authorised to do so. Never post credentials or other secrets.</li>
                <li>
                    You keep the rights to your comments. You allow us to store them, show them to visitors of the
                    project or public page and remove them, within the access and retention rules described here.
                </li>
                <li>Feedback in uier&rsquo;s own feedback projects expires 90 days after its last change, whether left as a guest or while signed in. Our starter threads and their replies do not expire. Feedback in customer projects stays until it or its project is deleted; marking it done or archiving it does not delete it.</li>
                <li>You can remove your own messages. Removing a message can leave other people&rsquo;s replies in place. A separate whole-thread deletion removes the discussion; the thread author or a workspace admin can use it where offered. Workspace admins, including the uier team in our feedback projects, can moderate feedback.</li>
            </ul>

            <h2>Removal and outside copies</h2>
            <p>
                A workspace admin can delete a project. You can delete your account in Account → General.
                You can also request personal-data removal using
                the contact in our <a href={KnownPages.LegalPrivacyPolicy}>privacy policy</a>. Removing an account
                or someone&rsquo;s project access does not automatically delete all feedback they contributed.
                Cleanup can require retries. Deleted data can remain in backups for up to seven days; copies
                already delivered to reviewers, email, coding tools or connected services follow those
                recipients&rsquo; own retention and removal rules. We cannot promise immediate erasure of every copy.
            </p>

            <h2>Acceptable use</h2>
            <p>
                Follow the <a href={KnownPages.LegalAcceptableUsePolicy}>acceptable use policy</a>. We may remove any
                content or restrict access for violations. We explain the decision where the law requires it.
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
                We publish updates with a new effective date. For material changes affecting existing
                customers, we will give advance notice to affected workspace admins and obtain agreement
                where required. Changes apply prospectively. The notice procedure below applies to
                changes of subprocessor.
            </p>

            <h2>Law</h2>
            <p>
                These terms are governed by the laws of Croatia. Courts in Croatia have jurisdiction, unless the law
                of the country where you live as a consumer gives you the right to go to court there. You also keep
                the mandatory consumer protections that apply where you usually live.
            </p>

            <h2>Contact</h2>
            <p>
                <a href={`mailto:${brand.contact.email}`}>{brand.contact.email}</a>
            </p>
        </LegalDocument>
    );
}
