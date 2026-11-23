import { Add, Copy, Search, Settings, Share } from '@uier/ui-icons';
import { Avatar } from '@uier/ui-primitives/Avatar';
import { Button } from '@uier/ui-primitives/Button';
import { Checkbox } from '@uier/ui-primitives/Checkbox';
import { Chip } from '@uier/ui-primitives/Chip';
import { IconButton } from '@uier/ui-primitives/IconButton';
import { Input } from '@uier/ui-primitives/Input';
import { Typography } from '@uier/ui-primitives/Typography';
import { Logo } from '@uier/brand/Logo';
import { Mark } from '@uier/brand/Mark';
import { Pin } from '@uier/brand/Pin';
import { ToolbarIllustration } from '../ToolbarIllustration';
import { ReviewThreadDemo } from '../../marketing/ReviewThreadDemo';
import { CheckList, Chip as LabelChip, InlineLink, NumberedList, Panel, StepsPanel, Tile } from '../../marketing/ContentPage';
import { Specimen, State } from './Specimen';

// The brand marks and the public site's kit: @uier/ui-primitives and the ContentPage blocks.

export function BrandMarkSpecimens() {
    return (
        <>
            <Specimen id="brand-logo">
                <State label="Lockup sizes"><Logo size={18} /><Logo size={28} /><Logo size={40} /></State>
                <State label="Mark only"><Logo size={28} markOnly /><Logo size={44} markOnly /></State>
                <State label="Minimum"><Logo size={20} /><Logo size={20} markOnly /></State>
            </Specimen>
            <Specimen id="brand-mark">
                <State label="Sizes"><Mark size={16} /><Mark size={24} /><Mark size={32} /><Mark size={48} /></State>
                <State label="With a title"><Mark size={32} title="uier" /></State>
            </Specimen>
            <Specimen id="brand-pin">
                <State label="New thread"><Pin number={1} /></State>
                <State label="With replies"><Pin number={6} messages={3} /><Pin number={128} messages={12} /></State>
                <State label="Upside down"><Pin number={6} messages={3} upsideDown /></State>
                <State label="Without a number"><Pin /></State>
                <State label="Sizes"><Pin number={4} size={24} /><Pin number={4} /><Pin number={4} size={40} /></State>
            </Specimen>
        </>
    );
}

export function SiteKitSpecimens() {
    return (
        <>
            <Specimen id="site-button">
                <State label="Solid"><Button variant="solid">Get started</Button></State>
                <State label="Outlined"><Button variant="outlined">See how it works</Button></State>
                <State label="Soft"><Button variant="soft">Read the guide</Button></State>
                <State label="Plain"><Button variant="plain">Cancel</Button></State>
                <State label="Link"><Button variant="link">All features</Button></State>
                <State label="Sizes">
                    <Button variant="solid" size="xs">Extra small</Button>
                    <Button variant="solid" size="sm">Small</Button>
                    <Button variant="solid" size="md">Medium</Button>
                    <Button variant="solid" size="lg">Large</Button>
                </State>
                <State label="With decorators">
                    <Button variant="solid" startDecorator={<Add size={16} strokeWidth={1.75} />}>New project</Button>
                    <Button variant="outlined" endDecorator={<Share size={16} strokeWidth={1.75} />}>Share</Button>
                </State>
                <State label="Disabled">
                    <Button variant="solid" disabled>Get started</Button>
                    <Button variant="outlined" disabled>See how it works</Button>
                </State>
                <State label="Loading"><Button variant="solid" loading>Sending</Button></State>
            </Specimen>
            <Specimen id="site-icon-button">
                <State label="Plain"><IconButton variant="plain" aria-label="Search"><Search size={20} strokeWidth={1.75} /></IconButton></State>
                <State label="Outlined"><IconButton variant="outlined" aria-label="Copy"><Copy size={20} strokeWidth={1.75} /></IconButton></State>
                <State label="Solid"><IconButton variant="solid" aria-label="Settings"><Settings size={20} strokeWidth={1.75} /></IconButton></State>
                <State label="Disabled"><IconButton variant="outlined" disabled aria-label="Copy, disabled"><Copy size={20} strokeWidth={1.75} /></IconButton></State>
                <State label="Sizes">
                    <IconButton variant="outlined" size="xs" aria-label="Copy, extra small"><Copy size={16} strokeWidth={1.75} /></IconButton>
                    <IconButton variant="outlined" size="sm" aria-label="Copy, small"><Copy size={16} strokeWidth={1.75} /></IconButton>
                    <IconButton variant="outlined" size="md" aria-label="Copy, medium"><Copy size={20} strokeWidth={1.75} /></IconButton>
                    <IconButton variant="outlined" size="lg" aria-label="Copy, large"><Copy size={24} strokeWidth={1.75} /></IconButton>
                </State>
            </Specimen>
            <Specimen id="site-input">
                <State label="Empty"><Input label="Email" placeholder="you@company.com" type="email" fullWidth /></State>
                <State label="With helper text"><Input label="Domain" helperText="Comments are stored per domain." defaultValue="cafelumen.com" className="font-mono" fullWidth /></State>
                <State label="Disabled"><Input label="Project" defaultValue="Cafe Lumen" disabled fullWidth /></State>
                <State label="Soft"><Input label="Name" variant="soft" placeholder="Your name" fullWidth /></State>
                <State label="With decorator"><Input aria-label="Search the guides" placeholder="Search the guides" startDecorator={<Search size={16} strokeWidth={1.75} className="ml-3" />} fullWidth /></State>
            </Specimen>
            <Specimen id="site-checkbox">
                <State label="Unchecked"><Checkbox label="Show resolved" /></State>
                <State label="Checked"><Checkbox label="Show resolved" defaultChecked /></State>
                <State label="Disabled"><Checkbox label="Show archived" disabled /></State>
            </Specimen>
            <Specimen id="site-chip">
                <State label="Outlined"><Chip variant="outlined" size="sm">Open</Chip></State>
                <State label="With a status dot"><Chip variant="outlined" size="sm" startDecorator={<span className="size-1.5 rounded-full bg-[hsl(var(--brand-success))]" />}>Resolved</Chip></State>
                <State label="Soft"><Chip variant="soft" size="sm">Free</Chip></State>
                <State label="Sizes"><Chip variant="outlined" size="sm">Small</Chip><Chip variant="outlined" size="md">Medium</Chip><Chip variant="outlined" size="lg">Large</Chip></State>
                <State label="Page label"><LabelChip>WordPress</LabelChip></State>
                <State label="Unread count"><span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[hsl(var(--brand-accent))] px-1.5 text-[11px] font-semibold text-white">3</span></State>
            </Specimen>
            <Specimen id="site-avatar">
                <State label="Sizes"><Avatar size="sm">A</Avatar><Avatar size="md">M</Avatar><Avatar size="lg">L</Avatar></State>
                <State label="Picture"><Avatar size="md" src="/apple-touch-icon.png" alt="" /></State>
            </Specimen>
            <Specimen id="site-typography" columns={2}>
                <State label="Headings" className="flex-col items-start">
                    <Typography level="h3" component="div">Review any live website</Typography>
                    <Typography level="h4" component="div">Comments, pinned to the element</Typography>
                    <Typography level="h5" component="div">Resolved threads stay in the inbox</Typography>
                </State>
                <State label="Body" className="flex-col items-start">
                    <Typography level="body1">Open any page with review on and click the element you mean.</Typography>
                    <Typography level="body2" secondary>The comment stays attached to that element.</Typography>
                    <Typography level="body3" tertiary>2 comments · 1 resolved · 4 min ago</Typography>
                </State>
            </Specimen>
            <Specimen id="site-panel" columns={1}>
                <State label="Tiles">
                    <div className="w-full">
                        <Panel className="md:grid-cols-3">
                            <Tile title="Pinned comments">Click the element you mean. The comment stays on it.</Tile>
                            <Tile title="Screenshots" label="Automatic">Each comment keeps what the reviewer saw.</Tile>
                            <Tile title="Threads">Reply, mention and mark as done on the page.</Tile>
                        </Panel>
                    </div>
                </State>
                <State label="Steps">
                    <div className="w-full">
                        <StepsPanel steps={[
                            { title: 'Add the script', text: 'One tag on the site you review.' },
                            { title: 'Open with review on', text: 'Add ?review=true to any page.' },
                            { title: 'Click and write', text: 'The comment is pinned where you clicked.' }
                        ]} />
                    </div>
                </State>
            </Specimen>
            <Specimen id="site-lists" columns={3}>
                <State label="Check list" className="items-start"><CheckList items={['Works on any site', 'No account for guests', 'Screenshots on every comment']} /></State>
                <State label="Numbered list" className="items-start"><NumberedList items={['Open the page', 'Click what you mean', 'Write the comment']} /></State>
                <State label="Inline link"><p className="text-base">Read the <InlineLink href="#site-lists">install guide</InlineLink> first.</p></State>
            </Specimen>
            <Specimen id="site-toolbar" columns={2}>
                <State label="Signed in"><ToolbarIllustration /></State>
                <State label="Guest with attention"><ToolbarIllustration initials={null} unread={0} attention /></State>
                <State label="Small"><ToolbarIllustration size="sm" /></State>
            </Specimen>
            <Specimen id="site-thread" columns={1}>
                <State label="Open thread"><div className="w-full max-w-[360px]"><ReviewThreadDemo /></div></State>
            </Specimen>
        </>
    );
}
