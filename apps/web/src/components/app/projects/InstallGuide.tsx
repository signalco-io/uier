import { Tabs, TabsContent, TabsList, TabsTrigger } from '@signalco/ui-primitives/Tabs';
import { CopyBlock } from '../CopyBlock';
import { cspSnippet, embedScript, nextJsSnippet } from '../../../lib/app/integration';

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

/** Where and how to add the script on the common platforms, plus the CSP sources (Advanced) */
export function InstallGuide({ baseUrl, projectId }: { baseUrl: string; projectId: string }) {
    const script = embedScript(baseUrl, projectId);
    return (
        <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-3">
                <h2 className="m-0 text-xl font-semibold tracking-[-0.015em]">1. Copy the script</h2>
                <p className="m-0 text-sm text-muted-foreground">
                    Paste it before the closing <code className="font-mono">&lt;/body&gt;</code> tag on every page you want to review.
                    It loads the toolbar only when a page is opened with a review link
                    (<code className="font-mono">?toolbar-code={projectId}</code>), so visitors never see it.
                </p>
                <CopyBlock value={script} label="Copy the script" />
            </div>

            <div className="flex flex-col gap-3">
                <h2 className="m-0 text-xl font-semibold tracking-[-0.015em]">2. Add it to your site</h2>
                <Tabs defaultValue="html" className="flex flex-col gap-3">
                    <TabsList aria-label="Platform" className="flex-wrap self-start">
                        {platforms.map(platform => (
                            <TabsTrigger key={platform.id} value={platform.id}>{platform.label}</TabsTrigger>
                        ))}
                    </TabsList>
                    {platforms.map(platform => (
                        <TabsContent key={platform.id} value={platform.id} className="mt-0 flex flex-col gap-3">
                            <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
                                {platform.steps.map(step => <li key={step}>{step}</li>)}
                            </ol>
                            {platform.code && (
                                <CopyBlock value={platform.code(baseUrl, projectId)} label={`Copy the ${platform.label} code`} />
                            )}
                        </TabsContent>
                    ))}
                </Tabs>
            </div>

            <details className="group rounded-xl border px-4 py-3">
                <summary className="cursor-pointer select-none font-medium">Advanced: security headers</summary>
                <div className="mt-3 flex flex-col gap-3">
                    <p className="m-0 text-sm text-muted-foreground">
                        If your site sends a <code className="font-mono">Content-Security-Policy</code> header, add these sources to the
                        matching directives. Without them the browser blocks the toolbar. Sites without a CSP need nothing.
                    </p>
                    <CopyBlock value={cspSnippet(baseUrl)} label="Copy the CSP sources" />
                    <p className="m-0 text-sm text-muted-foreground">
                        The font is optional: when it is blocked the toolbar uses the system font.
                    </p>
                </div>
            </details>
        </div>
    );
}
