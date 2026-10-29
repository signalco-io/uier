import type { ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/components/ui/tabs';
import { CopyBlock } from '../CopyBlock';
import { cspSnippet, embedScript, nextJsSnippet, type EmbedVersion } from '../../../lib/app/integration';
import { InstallationCheck } from './InstallationCheck';

type Platform = {
    id: string;
    label: string;
    steps: string[];
    code?: (baseUrl: string, projectId: string, version?: EmbedVersion) => string;
    /** Where a site on the platform gets its Content-Security-Policy */
    csp: ReactNode;
};

const Code = ({ children }: { children: ReactNode }) => <code className="font-mono">{children}</code>;

// Only steps that put the script tag at the end of <body>, where the generic instructions say
const platforms: Platform[] = [
    {
        id: 'html',
        label: 'HTML',
        steps: ['Open the HTML of every page you want to review (or the shared template).', 'Paste the script right before the closing </body> tag.'],
        csp: <>If your server sends a <Code>Content-Security-Policy</Code> header, or a page has a CSP <Code>&lt;meta&gt;</Code> tag, add these sources to its matching directives.</>
    },
    {
        id: 'nextjs',
        label: 'Next.js',
        steps: ['Open app/layout.tsx (pages/_app.tsx with the Pages Router).', 'Add the script with next/script inside <body>.'],
        code: nextJsSnippet,
        csp: <>Next.js apps set a <Code>Content-Security-Policy</Code> in <Code>headers()</Code> of next.config.js, or in proxy.ts (middleware.ts before Next.js 16). If yours does, add these sources to its matching directives.</>
    },
    {
        id: 'react',
        label: 'React',
        steps: ['Open index.html (public/index.html with Create React App, the project root with Vite).', 'Paste the script right before the closing </body> tag.'],
        csp: <>A React app gets its <Code>Content-Security-Policy</Code> from its host (vercel.json, Netlify <Code>_headers</Code>, your server) or a CSP <Code>&lt;meta&gt;</Code> tag in index.html. If yours has one, add these sources to its matching directives.</>
    },
    {
        id: 'wordpress',
        label: 'WordPress',
        steps: ['Use a code snippets plugin such as WPCode and add the script to the site-wide footer.', 'Or, in a child theme, paste it into footer.php right before </body>.'],
        csp: <>WordPress sends no <Code>Content-Security-Policy</Code> by default. If a security plugin, your host or the server config (.htaccess, nginx) adds one, add these sources to its matching directives there.</>
    },
    {
        id: 'webflow',
        label: 'Webflow',
        steps: ['Open Site settings, then Custom code.', 'Paste the script into Footer code and publish the site.'],
        csp: <>Webflow sends a <Code>Content-Security-Policy</Code> only with custom security headers (Enterprise). If your site has one, add these sources to it in Site settings, Publishing, Custom headers, then publish again.</>
    },
    {
        id: 'shopify',
        label: 'Shopify',
        steps: ['Open Online Store, Themes, then Edit code on your theme.', 'In layout/theme.liquid, paste the script right before </body> and save.'],
        csp: <>Shopify stores send a <Code>Content-Security-Policy</Code> that does not limit scripts, so most need nothing. If layout/theme.liquid has a CSP <Code>&lt;meta&gt;</Code> tag, add these sources to its matching directives.</>
    }
];

/** One numbered step, joined to the next by a line */
function Step({ number, title, last = false, children }: { number: number; title: string; last?: boolean; children: ReactNode }) {
    return (
        <li className="relative flex gap-4 pb-10 last:pb-0">
            {!last && <span aria-hidden="true" className="absolute top-9 bottom-1 left-3.5 w-px bg-border" />}
            <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-sm font-medium tabular-nums">
                {number}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
                <h2 className="m-0 text-base leading-6 font-semibold tracking-[-0.01em]">
                    <span className="sr-only">Step {number}: </span>
                    {title}
                </h2>
                {children}
            </div>
        </li>
    );
}

/** The CSP sources, and where the platform's site sets its policy */
function SecurityHeaders({ baseUrl, platform }: { baseUrl: string; platform: Platform }) {
    return (
        <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="group/advanced h-auto self-start px-0 py-1 text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent aria-expanded:text-foreground dark:hover:bg-transparent">
                    <ChevronRightIcon data-icon="inline-start" className="transition-transform group-data-open/advanced:rotate-90" />
                    Advanced: security headers
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3">
                <p className="m-0 text-sm text-muted-foreground">
                    {platform.csp} Without them the browser blocks the toolbar.
                </p>
                <CopyBlock value={cspSnippet(baseUrl)} label="Copy the CSP sources" />
                <p className="m-0 text-sm text-muted-foreground">
                    The font is optional: when it is blocked the toolbar uses the system font.
                </p>
            </CollapsibleContent>
        </Collapsible>
    );
}

/**
 * Where and how to add the script on the common platforms (with the CSP sources, in Advanced), then
 * opening a review link (`reviewStep`)
 */
export function InstallGuide({ baseUrl, projectId, publicId, urls, reviewStep }: { baseUrl: string; projectId: string; publicId: string; urls: string[]; reviewStep: ReactNode }) {
    const script = embedScript(baseUrl, publicId);
    return (
        <div className="flex flex-col gap-8">
            <ol className="m-0 flex list-none flex-col p-0">
                <Step number={1} title="Copy the script">
                    <p className="m-0 text-sm text-muted-foreground">
                        Paste it before the closing <code className="font-mono">&lt;/body&gt;</code> tag on every page you want to review.
                        It loads the toolbar only when a page is opened with a review link
                        (<code className="font-mono">?toolbar-code={publicId}</code>), so visitors never see it.
                    </p>
                    <CopyBlock value={script} label="Copy the script" />
                    <Collapsible className="flex flex-col gap-3">
                        <CollapsibleTrigger asChild>
                            <Button variant="outline" size="sm" className="self-start">Pin this version</Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="flex flex-col gap-3">
                            <p className="m-0 text-sm text-muted-foreground">
                                This version includes an integrity check. It gets fixes only when you update the snippet.
                                Pinned production bundles work with the review API for one year after their last release as the current version.
                            </p>
                            <CopyBlock value={embedScript(baseUrl, publicId, 'pinned')} label="Copy the pinned script" />
                        </CollapsibleContent>
                    </Collapsible>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        Project code
                        <code className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[13px] text-foreground">{publicId}</code>
                    </div>
                </Step>
                <Step number={2} title="Add it to your site">
                    <Tabs defaultValue="html" className="gap-3">
                        <TabsList aria-label="Platform" className="flex-wrap justify-start group-data-horizontal/tabs:h-auto">
                            {platforms.map(platform => (
                                <TabsTrigger key={platform.id} value={platform.id} className="flex-none">{platform.label}</TabsTrigger>
                            ))}
                        </TabsList>
                        {platforms.map(platform => (
                            <TabsContent key={platform.id} value={platform.id} className="flex flex-col gap-3">
                                <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
                                    {platform.steps.map(step => <li key={step}>{step}</li>)}
                                </ol>
                                {platform.code && (<>
                                    <CopyBlock value={platform.code(baseUrl, publicId)} label={`Copy the ${platform.label} code`} />
                                    <Collapsible className="flex flex-col gap-3">
                                        <CollapsibleTrigger asChild>
                                            <Button variant="outline" size="sm" className="self-start">Pin the {platform.label} version</Button>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent className="flex flex-col gap-3">
                                            <p className="m-0 text-sm text-muted-foreground">It gets fixes only when you update the snippet.</p>
                                            <CopyBlock value={platform.code(baseUrl, publicId, 'pinned')} label={`Copy the pinned ${platform.label} code`} />
                                        </CollapsibleContent>
                                    </Collapsible>
                                </>)}
                                <SecurityHeaders baseUrl={baseUrl} platform={platform} />
                            </TabsContent>
                        ))}
                    </Tabs>
                </Step>
                <Step number={3} title="Open a review link" last>
                    <p className="m-0 text-sm text-muted-foreground">
                        Once the script is live, a review link opens your site with the toolbar. Pin a comment and it shows up in the app.
                    </p>
                    {reviewStep}
                    <InstallationCheck key={urls.join('\0')} projectId={projectId} publicId={publicId} urls={urls} />
                </Step>
            </ol>

        </div>
    );
}
