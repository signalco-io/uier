import type { Metadata } from 'next';
import { Button } from '@signalco/ui-primitives/Button';
import { brand } from '@uier/brand';
import { InlineLink, PageHeader, PageSection, Panel, Tile } from '../../../../src/components/marketing/ContentPage';

// Licenses as declared in each package.json and the root LICENSE. Keep this table in step with them
// (and with the README "License" section).

export const metadata: Metadata = {
    title: 'Open source',
    description: `${brand.name} is open source: the website, the comments API, the toolbar, the brand and the infrastructure are in one public repository.`
};

const blob = (path: string) => `${brand.repository}/blob/main/${path}`;
const tree = (path: string) => `${brand.repository}/tree/main/${path}`;

const packages = [
    {
        path: 'apps/web',
        what: `The ${brand.domain} website, the comments API and the published /toolbar.js`,
        license: 'AGPL-3.0-only',
        licenseHref: blob('LICENSE')
    },
    {
        path: 'packages/toolbar',
        what: 'The review toolbar that runs on the reviewed page',
        license: 'MIT',
        licenseHref: blob('packages/toolbar/package.json')
    },
    {
        path: 'packages/brand',
        what: 'Design tokens, the logo components and assets, and BRAND.md',
        license: 'MIT',
        licenseHref: blob('packages/brand/package.json')
    },
    {
        path: 'infra',
        what: 'The Pulumi program for hosting, DNS and the database',
        license: 'MIT',
        licenseHref: blob('infra/package.json')
    }
];

export default function OpenSourcePage() {
    return (
        <main className="flex flex-col pb-16">
            <PageHeader
                title="Open source"
                lead={`${brand.name} is built in the open: everything is in one public repository.`}>
                <div className="flex flex-wrap items-center gap-2.5">
                    <Button variant="solid" size="lg" href={brand.repository}>View on GitHub</Button>
                    <Button variant="outlined" size="lg" href={blob('CONTRIBUTING.md')}>How to contribute</Button>
                </div>
            </PageHeader>

            <PageSection
                id="licenses"
                title="Licenses"
                lead={<>The web app is under the GNU Affero General Public License, the packages and the infrastructure under the MIT license. Each package declares its license in its <code className="font-mono text-[0.875em]">package.json</code>; anything without its own license is covered by the root <InlineLink href={blob('LICENSE')}>LICENSE</InlineLink> (AGPL-3.0).</>}>
                <Panel as="ul">
                    {packages.map(item => (
                        <li key={item.path} className="flex flex-col gap-1 p-6 md:flex-row md:items-baseline md:gap-6">
                            <a href={tree(item.path)} className="font-mono text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground md:w-44 md:shrink-0">{item.path}</a>
                            <span className="text-sm text-muted-foreground md:flex-1">{item.what}</span>
                            <a href={item.licenseHref} className="text-sm font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">{item.license}</a>
                        </li>
                    ))}
                </Panel>
                <Panel className="md:grid-cols-2">
                    <Tile title="MIT: the toolbar, the brand, the infrastructure">
                        <p>Use, change and ship them anywhere, in open or closed products, as long as you keep the copyright and license notice.</p>
                    </Tile>
                    <Tile title="AGPL-3.0: the web app">
                        <p>Run, change and share it freely. If you let people use a changed version over a network, you must offer them its source code under the same license.</p>
                    </Tile>
                </Panel>
                <p className="max-w-[720px] text-sm text-muted-foreground">
                    This is a summary. The license texts decide: <InlineLink href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL-3.0</InlineLink> and <InlineLink href="https://opensource.org/license/mit">MIT</InlineLink>.
                </p>
            </PageSection>

            <PageSection
                id="contribute"
                title="Contribute"
                lead={<>Bug reports, ideas and pull requests are welcome. The <InlineLink href={blob('CONTRIBUTING.md')}>contributing guide</InlineLink> covers setup, conventions and what a pull request needs.</>}>
                <Panel className="md:grid-cols-3">
                    <Tile title="Report a problem">
                        <p>Open an <InlineLink href={brand.issues}>issue on GitHub</InlineLink>. Security problems go to <InlineLink href={`mailto:${brand.contact.security}`}>{brand.contact.security}</InlineLink> instead.</p>
                    </Tile>
                    <Tile title="Run it locally">
                        <p>Node.js 24 and pnpm, then <code className="font-mono">pnpm install</code> and <code className="font-mono">pnpm dev</code>. No database needed: comments stay in memory.</p>
                    </Tile>
                    <Tile title="Open a pull request">
                        <p>Against <code className="font-mono">main</code>, with Conventional Commits. Typecheck, build and end-to-end tests run on every pull request.</p>
                    </Tile>
                </Panel>
            </PageSection>
        </main>
    );
}
