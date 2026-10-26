import type { Metadata } from 'next';
import type { ComponentProps, PropsWithChildren } from 'react';
import { Typography } from '@signalco/ui-primitives/Typography';
import { Button } from '@signalco/ui-primitives/Button';
import { Input } from '@signalco/ui-primitives/Input';
import { Checkbox } from '@signalco/ui-primitives/Checkbox';
import { Chip } from '@signalco/ui-primitives/Chip';
import { Avatar } from '@signalco/ui-primitives/Avatar';
import { brand } from '@uier/brand';
import { Logo } from '@uier/brand/Logo';
import { Mark } from '@uier/brand/Mark';
import { Pin } from '@uier/brand/Pin';
import { ThemeToggle } from '../../../../src/components/brand/ThemeToggle';
import { TokenSwatch } from '../../../../src/components/brand/TokenSwatch';
import { Badge as AppBadge } from '../../../../src/components/ui/badge';
import { Button as AppButton } from '../../../../src/components/ui/button';
import { ToolbarIllustration } from '../../../../src/components/brand/ToolbarIllustration';
import { ReviewThreadDemo } from '../../../../src/components/marketing/ReviewThreadDemo';
import { InlineLink, PageSection, Panel, Tile } from '../../../../src/components/marketing/ContentPage';

// The living brand page. Everything here renders from @uier/brand and the UI kit with the
// brand tokens applied, so it shows the brand as it ships. The written rules: packages/brand/BRAND.md.

export const metadata: Metadata = {
    title: 'Brand',
    description: `How ${brand.name} looks and sounds: logo, colour, type, shape and the review layer.`
};

const brandMdUrl = `${brand.repository}/blob/main/packages/brand/BRAND.md`;
const packageUrl = `${brand.repository}/tree/main/packages/brand`;

const sections = [
    { id: 'principles', title: 'Principles' },
    { id: 'name', title: 'Name and voice' },
    { id: 'logo', title: 'Logo' },
    { id: 'color', title: 'Colour' },
    { id: 'type', title: 'Typography' },
    { id: 'shape', title: 'Shape and motion' },
    { id: 'components', title: 'Components' },
    { id: 'review', title: 'Review layer' },
    { id: 'assets', title: 'Assets' }
];

/** The brand page's sections take the full width: their specimens need it */
function Section(props: ComponentProps<typeof PageSection>) {
    return <PageSection wide {...props} />;
}

function Spec({ children }: PropsWithChildren) {
    return <span className="font-mono text-[11px] text-muted-foreground">{children}</span>;
}

const radii = [
    { px: 4, className: 'rounded-[4px]', use: 'checkbox, tag' },
    { px: 6, className: 'rounded-sm', use: 'small button, menu item' },
    { px: 8, className: 'rounded-md', use: 'button, input' },
    { px: 10, className: 'rounded-lg', use: 'large button (--radius)' },
    { px: 12, className: 'rounded-xl', use: 'card, menu, popover' },
    { px: 16, className: 'rounded-2xl', use: 'sidebar, dialog, tile' },
    { px: 24, className: 'rounded-3xl', use: 'browser frame, hero media' }
];

const spacing = [
    [4, 'icon to label'], [8, 'inside a pill, between buttons'], [12, 'list rows, menu padding'],
    [16, 'card and popover padding'], [24, 'between cards, dialog padding'], [32, 'section inner padding'], [64, 'between marketing sections']
] as const;

export default function BrandPage() {
    return (
        <main className="flex flex-col pb-16">
            <header className="flex flex-wrap items-start justify-between gap-6 pt-12 md:pt-20">
                <div className="flex max-w-[720px] flex-col gap-5">
                    <Logo size={44} />
                    <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">{brand.name} brand</h1>
                    <p className="text-lg leading-relaxed text-muted-foreground">
                        How {brand.name} looks and sounds, rendered live from <InlineLink href={packageUrl}>packages/brand</InlineLink>.
                        The rules are in <InlineLink href={brandMdUrl}>BRAND.md</InlineLink>.
                    </p>
                    <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                        {sections.map(section => (
                            <a key={section.id} href={`#${section.id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{section.title}</a>
                        ))}
                    </nav>
                </div>
                <ThemeToggle />
            </header>

            <Section id="principles" title="Quiet, precise, rounded, and a little pointed." lead="The brand follows the product. Three principles decide most questions.">
                <Panel className="md:grid-cols-3">
                    <Tile title="Minimal">One typeface, one accent, borders instead of shadows. Nothing on screen that is not doing work.</Tile>
                    <Tile title="Rounded">Every corner is soft: 8 px on controls, 12 on cards, 16 on panels, full pills for the toolbar and pins.</Tile>
                    <Tile title="Pointed">The mark keeps one sharp corner so it can point at what you are reviewing. Copy is short and direct.</Tile>
                </Panel>
            </Section>

            <Section id="name" title="Name and voice">
                <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                    <div className="flex flex-col gap-4">
                        <p className="text-[40px] font-semibold leading-none tracking-[-0.03em]">{brand.tagline}</p>
                        <p className="text-base leading-relaxed text-muted-foreground">{brand.description}</p>
                        <Spec>tagline · short description · long description, all in src/brand.ts</Spec>
                    </div>
                    <ul className="flex flex-col gap-2.5 text-sm leading-relaxed text-secondary-foreground">
                        <li><strong className="font-medium text-foreground">Always lowercase.</strong> {brand.name}, even at the start of a sentence. Never “Uier”, never “UIER”. Read “{brand.pronunciation}”.</li>
                        <li><strong className="font-medium text-foreground">Sentence case everywhere.</strong> No Title Case headings, no ALL CAPS labels, no exclamation marks.</li>
                        <li><strong className="font-medium text-foreground">Say what happens.</strong> “The comment stays attached to that element”, not “seamless” or “powerful”.</li>
                        <li><strong className="font-medium text-foreground">Only claim what the product does.</strong> No invented stats, customers or features.</li>
                        <li><strong className="font-medium text-foreground">Plain in running text.</strong> The name gets the same weight and colour as the words around it.</li>
                    </ul>
                </div>
            </Section>

            <Section id="logo" title="The mark is a pin" lead="A 1:1 square with three corners at full radius and the top-left corner left sharp. The sharp corner is the pointer: in the product it sits where a comment is anchored, so the logo is the same shape people click on every day.">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-6 rounded-2xl border bg-white p-7 text-[#0A0A0A]">
                        <div className="flex items-center justify-between text-xs text-[#707070]"><span>On light</span><span className="font-mono text-[11px]">#0A0A0A on #FFFFFF</span></div>
                        <div className="flex flex-wrap items-center gap-10">
                            <Logo size={40} />
                            <Logo size={44} markOnly />
                            <span className="text-[28px] font-semibold leading-none tracking-[-0.03em]">{brand.name}</span>
                        </div>
                    </div>
                    <div className="flex flex-col gap-6 rounded-2xl bg-black p-7 text-white">
                        <div className="flex items-center justify-between text-xs text-[#A3A3A3]"><span>On dark</span><span className="font-mono text-[11px]">#FFFFFF on #000000</span></div>
                        <div className="flex flex-wrap items-center gap-10">
                            <Logo size={40} />
                            <Logo size={44} markOnly />
                            <span className="text-[28px] font-semibold leading-none tracking-[-0.03em]">{brand.name}</span>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-4">
                    <div className="flex flex-col gap-1"><Spec>mark : wordmark</Spec><span>mark height = 0.8 × font size</span></div>
                    <div className="flex flex-col gap-1"><Spec>gap</Spec><span>0.4 × font size</span></div>
                    <div className="flex flex-col gap-1"><Spec>clear space</Spec><span>0.5 × mark height on every side</span></div>
                    <div className="flex flex-col gap-1"><Spec>minimum</Spec><span>mark 16 px · lockup 20 px tall</span></div>
                </div>
                <p className="max-w-[720px] text-sm leading-relaxed text-muted-foreground">
                    The wordmark is “{brand.name}” in Geist Semibold with −3 % letter-spacing. Do not capitalise the name, recolour the mark,
                    rotate or flip it, add an outline, shadow or gradient, or put a tagline inside the lockup.
                    Use <code className="font-mono">&lt;Logo /&gt;</code>, <code className="font-mono">&lt;Mark /&gt;</code> and <code className="font-mono">&lt;Pin /&gt;</code> from the package; never redraw the shape.
                </p>
            </Section>

            <Section id="color" title="Ink on paper. One accent, kept for the review layer." lead="Neutral greys with no blue cast; dark mode is true black, like the toolbar. The values below are read from the stylesheet in the current theme, so switch the theme above to see both sets.">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                    <TokenSwatch token="--background" name="Background" role="page" bordered />
                    <TokenSwatch token="--muted" name="Muted" role="muted surface, hover rows" bordered />
                    <TokenSwatch token="--border" name="Border" role="border, divider" />
                    <TokenSwatch token="--muted-foreground" name="Muted text" role="captions, meta (≥ 4.5:1)" />
                    <TokenSwatch token="--secondary-foreground" name="Secondary text" role="supporting copy" />
                    <TokenSwatch token="--foreground" name="Text" role="text, icons" />
                    <TokenSwatch token="--primary" name="Primary" role="solid buttons, pins" />
                    <TokenSwatch token="--brand-accent" name="Blue" role="the accent (white text on it: 5.2:1)" />
                    <TokenSwatch token="--brand-success" name="Green" role="resolved" />
                    <TokenSwatch token="--brand-warning" name="Amber" role="warning" />
                    <TokenSwatch token="--destructive" name="Red" role="destructive" />
                    <TokenSwatch token="--brand-selection" name="Selection" role="commented text range" bordered />
                    <TokenSwatch token="--sidebar" name="Sidebar" role="the app's sidebar" bordered />
                    <TokenSwatch token="--sidebar-accent" name="Sidebar accent" role="sidebar hover, current item" />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-muted px-4 py-3 text-sm leading-relaxed">
                    <span>Where blue shows up:</span>
                    <span className="rounded bg-[hsl(var(--brand-selection))] px-0.5">a selected text range</span>
                    <span className="inline-flex items-center gap-2">a <span className="inline-block h-6 w-11 rounded-md border ring-2 ring-[hsl(var(--brand-accent))] ring-offset-2 ring-offset-background" /> focused control</span>
                    <span className="inline-flex items-center gap-2">an <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[hsl(var(--brand-accent))] px-1.5 text-[11px] font-semibold text-white">3</span> unread count</span>
                    <span>and a <a href="#color" className="text-[hsl(var(--brand-accent-text))] underline underline-offset-2">link</a>.</span>
                    <span className="text-secondary-foreground">Primary buttons and pins stay ink. Blue is never a background.</span>
                </div>
            </Section>

            <Section id="type" title="Geist for everything. Geist Mono for what a machine wrote." lead="Loaded with next/font from the geist package. Three weights: 400 for reading, 500 for labels and buttons, 600 for headings. Sentence case, tabular figures for counts.">
                <div className="flex flex-col gap-7">
                    <div className="flex flex-col gap-1"><span className="text-[64px] font-semibold leading-none tracking-[-0.04em]">Say it on the page.</span><Spec>display · 64 / 64 · −4% · 600</Spec></div>
                    <div className="flex flex-col gap-1"><span className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em]">Comments, pinned to the element</span><Spec>h1 · 40 / 44 · −3% · 600</Spec></div>
                    <div className="flex flex-col gap-1"><span className="text-[28px] font-semibold leading-[1.2] tracking-[-0.02em]">Review any live website</span><Spec>h2 · 28 / 34 · −2% · 600</Spec></div>
                    <div className="flex flex-col gap-1"><span className="text-xl font-semibold leading-[1.3] tracking-[-0.015em]">Resolved threads stay in the inbox</span><Spec>h3 · 20 / 26 · −1.5% · 600</Spec></div>
                    <div className="flex flex-col gap-1"><p className="max-w-[620px] text-base leading-[1.6]">Open any page with review on, click the element you mean, and write. The comment stays attached to that element, with the viewport, browser and device it was left from, so the fix is never a guess.</p><Spec>body · 16 / 26 · 0 · 400</Spec></div>
                    <div className="flex flex-wrap gap-10">
                        <div className="flex flex-col gap-1"><span className="text-sm leading-relaxed">Shown in the sidebar, thread items and menus.</span><Spec>small · 14 / 21 · 0 · 400</Spec></div>
                        <div className="flex flex-col gap-1"><span className="text-xs font-medium tabular-nums text-muted-foreground">2 comments · 1 resolved · 4 min ago</span><Spec>caption · 12 / 17 · 0 · 500 · tnum</Spec></div>
                        <div className="flex flex-col gap-1"><span className="font-mono text-[13px]">{brand.domain}/app?review=true</span><Spec>mono · 13 / 20 · 0 · 400</Spec></div>
                    </div>
                </div>
            </Section>

            <Section id="shape" title="Rounded, bordered, barely animated." lead="Radius grows with the surface. Borders separate, shadows float. Two levels of elevation only.">
                <div className="flex flex-wrap items-end gap-4">
                    {radii.map(radius => (
                        <div key={radius.px} className="flex flex-col items-center gap-2">
                            <div className={`${radius.className} border border-foreground`} style={{ width: 48 + radius.px * 3, height: 48 + radius.px * 3 }} />
                            <span className="text-xs font-medium">{radius.px}</span>
                            <span className="text-center text-[11px] leading-snug text-muted-foreground">{radius.use}</span>
                        </div>
                    ))}
                    <div className="flex flex-col items-center gap-2">
                        <div className="h-12 w-36 rounded-full bg-foreground" />
                        <span className="text-xs font-medium">full</span>
                        <span className="text-center text-[11px] leading-snug text-muted-foreground">toolbar, pin, avatar, badge</span>
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="flex flex-col gap-3 rounded-2xl border p-5">
                        <div className="flex justify-between text-xs text-muted-foreground"><span>Space</span><span>4 px grid</span></div>
                        <ul className="flex flex-col gap-1.5">
                            {spacing.map(([px, use]) => (
                                <li key={px} className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
                                    <span className="h-3.5 rounded-sm bg-foreground" style={{ width: px }} />
                                    <span className="w-6 font-mono text-foreground">{px}</span>
                                    <span>{use}</span>
                                </li>
                            ))}
                        </ul>
                        <span className="text-xs leading-relaxed text-muted-foreground">Controls are 32 (sm), 36 (md) or 44 (lg) tall. Touch targets never below 44.</span>
                    </div>
                    <div className="flex flex-col gap-3 rounded-2xl border p-5">
                        <div className="flex justify-between text-xs text-muted-foreground"><span>Borders and elevation</span><span>two levels</span></div>
                        <div className="flex flex-col gap-0.5 rounded-xl border px-3.5 py-3"><span className="text-[13px] font-medium">Resting</span><span className="text-[11px] text-muted-foreground">1 px border, no shadow. Cards, inputs, sections, tables.</span></div>
                        <div className="flex flex-col gap-0.5 rounded-xl border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.08)]"><span className="text-[13px] font-medium">Floating</span><span className="text-[11px] text-muted-foreground">Border plus 0 1px 2px 4% and 0 8px 24px 8%. Toolbar, popovers, menus, dialogs.</span></div>
                        <span className="text-xs leading-relaxed text-muted-foreground">Focus: 2 px blue ring at 2 px offset, keyboard only.</span>
                    </div>
                    <div className="flex flex-col gap-3 rounded-2xl border p-5">
                        <div className="flex justify-between text-xs text-muted-foreground"><span>Icons and motion</span><span>Lucide · 1.75 stroke</span></div>
                        <span className="text-xs leading-relaxed text-muted-foreground">16 inline with text, 20 in buttons, 24 in the toolbar. Outlined only; the pin is the one filled shape.</span>
                        <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-secondary-foreground">
                            <li><span className="font-mono text-foreground">150ms ease-out</span> enter and exit: fade plus 8 px slide.</li>
                            <li><span className="font-mono text-foreground">120ms</span> hover and press: colour only, no scale.</li>
                            <li><span className="font-mono text-foreground">none</span> on page load. No bounces, parallax or gradient movement.</li>
                        </ul>
                    </div>
                </div>
            </Section>

            <Section id="components" title="The signalco UI kit, with the tokens applied." lead="Real components from @signalco/ui-primitives. Solid is ink, outlined is the border, plain is nothing until hovered. Do not build parallel components.">
                <div className="flex flex-col gap-8 rounded-2xl border p-6">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <Button variant="solid">Get started</Button>
                        <Button variant="outlined">See how it works</Button>
                        <Button variant="soft">Soft</Button>
                        <Button variant="plain">Cancel</Button>
                        <Button variant="solid" disabled>Disabled</Button>
                    </div>
                    <div className="flex flex-wrap items-end gap-2.5">
                        <Button variant="solid" size="sm">Small</Button>
                        <Button variant="solid" size="md">Medium</Button>
                        <Button variant="solid" size="lg">Large</Button>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <Input label="Email" placeholder="you@company.com" type="email" fullWidth />
                        <Input label="Domain" helperText="Comments are stored per domain." defaultValue="app.example.com" className="font-mono" fullWidth />
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                        <Checkbox label="Show resolved" defaultChecked />
                        <Chip variant="outlined" size="sm">Open</Chip>
                        <Chip variant="outlined" size="sm" startDecorator={<span className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />}>Resolved</Chip>
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(var(--brand-accent))] px-1.5 text-[11px] font-semibold text-white">3</span>
                        <Avatar size="sm">A</Avatar>
                        <Avatar size="md">M</Avatar>
                    </div>
                </div>
                <div className="flex flex-col gap-4 rounded-2xl border p-6">
                    <p className="m-0 max-w-[720px] text-sm leading-relaxed text-muted-foreground">
                        The signed-in app is built from <a href="https://ui.shadcn.com" className="text-[hsl(var(--brand-accent-text))] underline underline-offset-2">shadcn/ui</a> components
                        (<code className="font-mono">apps/web/src/components/ui</code>) on the same tokens and the same rules: ink buttons, bordered cards, no resting shadows.
                    </p>
                    <div className="flex flex-wrap items-center gap-2.5">
                        <AppButton>Create project</AppButton>
                        <AppButton variant="outline">Open review</AppButton>
                        <AppButton variant="ghost">Cancel</AppButton>
                        <AppBadge variant="outline" className="gap-1.5">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" />
                            Open
                        </AppBadge>
                        <AppBadge variant="outline" className="gap-1.5">
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />
                            Done
                        </AppBadge>
                        <AppBadge variant="secondary">Bug report</AppBadge>
                    </div>
                </div>
            </Section>

            <Section id="review" title="The review layer is always ink." lead="The toolbar, pins and inbox are what the product is. They stay black on any site they land on and never try to match it. Threads follow the system theme, because people read and type in them.">
                <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="flex flex-col gap-6">
                        <ToolbarIllustration />
                        <div className="flex items-center gap-5">
                            <Pin count={1} />
                            <Pin count={2} />
                            <Pin count={12} />
                            <span className="text-sm text-muted-foreground">The pin: the mark on a 32 grid, ink fill, 2 px white ring, thread count inside.</span>
                        </div>
                        <p className="max-w-[560px] text-sm leading-relaxed text-muted-foreground">
                            Run the web app and the toolbar locally (<code className="font-mono">pnpm dev</code>) and open this page with <code className="font-mono">?review=true</code> to see the real thing on top of it.
                        </p>
                    </div>
                    <ReviewThreadDemo />
                </div>
            </Section>

            <Section id="assets" title="Assets and where things live" lead="Everything is generated from the mark and the constants; nothing is drawn twice.">
                <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                    <ul className="flex flex-col gap-2 text-sm">
                        <li><InlineLink href="/favicon.svg">favicon.svg</InlineLink> <span className="text-muted-foreground">· the bare mark, ink in light tabs and white in dark</span></li>
                        <li><InlineLink href="/apple-touch-icon.png">apple-touch-icon.png</InlineLink> <span className="text-muted-foreground">· black plate, white mark at 54 %</span></li>
                        <li><InlineLink href="/android-chrome-512x512.png">android-chrome-512x512.png</InlineLink> <span className="text-muted-foreground">· same plate, maskable</span></li>
                        <li><InlineLink href="/opengraph-image">opengraph-image</InlineLink> <span className="text-muted-foreground">· the 1200 × 630 social card, generated from the constants</span></li>
                        <li><InlineLink href="/manifest.webmanifest">manifest.webmanifest</InlineLink> <span className="text-muted-foreground">· name, icons and colours from the constants</span></li>
                    </ul>
                    <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed text-secondary-foreground">
                        <li>Change the value in <code className="font-mono text-foreground">packages/brand</code>: tokens.css for colour and radius, src/brand.ts for names and copy, src/Mark.tsx for the shape.</li>
                        <li>Update <InlineLink href={brandMdUrl}>BRAND.md</InlineLink> so the rule matches the value.</li>
                        <li>Re-render the icons if the mark changed: <code className="font-mono text-foreground">pnpm -C packages/brand icons</code>.</li>
                        <li>Check this page. It renders from the same code, so it shows the change as it ships.</li>
                    </ol>
                </div>
            </Section>
            <Typography level="body3" tertiary className="pt-8">
                Original design exploration: a Claude Design canvas, October 2026 (private). Everything that matters from it is in BRAND.md.
            </Typography>
        </main>
    );
}
