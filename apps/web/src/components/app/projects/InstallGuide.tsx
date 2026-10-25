import type { ReactNode } from 'react';
import { ChevronRightIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/components/ui/tabs';
import { CopyBlock } from '../CopyBlock';
import { cspSnippet, embedScript, nextJsSnippet } from '../../../lib/app/integration';
import { InstallationCheck } from './InstallationCheck';

type Platform = {
    id: string;
    label: string;
    steps: string[];
    code?: (baseUrl: string, projectId: string) => string;
};

// Only steps that put the script tag at the end of <body>, where the generic instructions say
const platforms: Platform[] = [
    {
        id: 'html',
        label: 'HTML',
        steps: ['Open the HTML of every page you want to review (or the shared template).', 'Paste the script right before the closing </body> tag.']
    },
    {
        id: 'nextjs',
        label: 'Next.js',
        steps: ['Open app/layout.tsx (pages/_app.tsx with the Pages Router).', 'Add the script with next/script inside <body>.'],
        code: nextJsSnippet
    },
    {
        id: 'react',
        label: 'React',
        steps: ['Open index.html (public/index.html with Create React App, the project root with Vite).', 'Paste the script right before the closing </body> tag.']
    },
    {
        id: 'wordpress',
        label: 'WordPress',
        steps: ['Use a code snippets plugin such as WPCode and add the script to the site-wide footer.', 'Or, in a child theme, paste it into footer.php right before </body>.']
    },
    {
        id: 'webflow',
        label: 'Webflow',
        steps: ['Open Site settings, then Custom code.', 'Paste the script into Footer code and publish the site.']
    },
    {
        id: 'shopify',
        label: 'Shopify',
        steps: ['Open Online Store, Themes, then Edit code on your theme.', 'In layout/theme.liquid, paste the script right before </body> and save.']
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

/**
 * Where and how to add the script on the common platforms, then opening a review link (`reviewStep`),
 * plus the CSP sources (Advanced)
 */
export function InstallGuide({ baseUrl, projectId, urls, reviewStep }: { baseUrl: string; projectId: string; urls: string[]; reviewStep: ReactNode }) {
    const script = embedScript(baseUrl, projectId);
    return (
        <div className="flex flex-col gap-8">
            <ol className="m-0 flex list-none flex-col p-0">
                <Step number={1} title="Copy the script">
                    <p className="m-0 text-sm text-muted-foreground">
                        Paste it before the closing <code className="font-mono">&lt;/body&gt;</code> tag on every page you want to review.
                        It loads the toolbar only when a page is opened with a review link
                        (<code className="font-mono">?toolbar-code={projectId}</code>), so visitors never see it.
                    </p>
                    <div id="install-script"><CopyBlock value={script} label="Copy the script" /></div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                        Project code
                        <code className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[13px] text-foreground">{projectId}</code>
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
                                {platform.code && (
                                    <CopyBlock value={platform.code(baseUrl, projectId)} label={`Copy the ${platform.label} code`} />
                                )}
                            </TabsContent>
                        ))}
                    </Tabs>
                </Step>
                <Step number={3} title="Open a review link" last>
                    <p className="m-0 text-sm text-muted-foreground">
                        Once the script is live, a review link opens your site with the toolbar. Pin a comment and it shows up in the app.
                    </p>
                    {reviewStep}
                    <InstallationCheck key={urls.join('\0')} projectId={projectId} urls={urls} />
                </Step>
            </ol>

            <Collapsible id="security-headers" className="rounded-xl border">
                <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="group/advanced h-auto w-full justify-start rounded-xl px-4 py-3 font-medium">
                        <ChevronRightIcon data-icon="inline-start" className="transition-transform group-data-open/advanced:rotate-90" />
                        Advanced: security headers
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="flex flex-col gap-3 px-4 pb-4">
                    <p className="m-0 text-sm text-muted-foreground">
                        If your site sends a <code className="font-mono">Content-Security-Policy</code> header, add these sources to the
                        matching directives. Without them the browser blocks the toolbar. Sites without a CSP need nothing.
                    </p>
                    <CopyBlock value={cspSnippet(baseUrl)} label="Copy the CSP sources" />
                    <p className="m-0 text-sm text-muted-foreground">
                        The font is optional: when it is blocked the toolbar uses the system font.
                    </p>
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}
