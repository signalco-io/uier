'use client';

import { useId, useState, type ReactNode } from 'react';
import {
    ArchiveIcon, ChevronRightIcon, CopyIcon, FolderIcon, GlobeIcon, InboxIcon, LayoutGridIcon, ListIcon,
    MessageSquareIcon, PlusIcon, SearchIcon, SettingsIcon, Trash2Icon, TriangleAlertIcon, UserPlusIcon
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/src/lib/utils';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/src/components/ui/alert';
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogMedia, AlertDialogTitle, AlertDialogTrigger
} from '@/src/components/ui/alert-dialog';
import { Autocomplete, AutocompleteContent, AutocompleteEmpty, AutocompleteInput, AutocompleteItem, AutocompleteList } from '@/src/components/ui/autocomplete';
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@/src/components/ui/avatar';
import { Badge } from '@/src/components/ui/badge';
import {
    Breadcrumb, BreadcrumbEllipsis, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator
} from '@/src/components/ui/breadcrumb';
import { Button } from '@/src/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/src/components/ui/card';
import { Checkbox } from '@/src/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/src/components/ui/collapsible';
import {
    Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger
} from '@/src/components/ui/dialog';
import {
    DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
    DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger
} from '@/src/components/ui/dropdown-menu';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/src/components/ui/empty';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/src/components/ui/field';
import { Input } from '@/src/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from '@/src/components/ui/input-group';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/src/components/ui/item';
import { Kbd, KbdGroup } from '@/src/components/ui/kbd';
import { Label } from '@/src/components/ui/label';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/src/components/ui/popover';
import { Progress, ProgressLabel, ProgressValue } from '@/src/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/src/components/ui/radio-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/src/components/ui/select';
import { Separator } from '@/src/components/ui/separator';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/src/components/ui/sheet';
import {
    Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton,
    SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider
} from '@/src/components/ui/sidebar';
import { Skeleton } from '@/src/components/ui/skeleton';
import { Toaster } from '@/src/components/ui/sonner';
import { Spinner } from '@/src/components/ui/spinner';
import { Switch } from '@/src/components/ui/switch';
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/src/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/src/components/ui/tabs';
import { Textarea } from '@/src/components/ui/textarea';
import { Toggle } from '@/src/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/src/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/src/components/ui/tooltip';
import { Specimen, State } from './Specimen';

// The app's shadcn/ui kit (src/components/ui), each component in the states the app uses.
// Example content is a review of an imaginary restaurant's website, like the landing page.

const roles = [
    { value: 'member', label: 'Member' },
    { value: 'admin', label: 'Admin' },
    { value: 'guest', label: 'Guest' }
];

const clients = ['Cafe Lumen', 'Harbor Kitchen', 'Olive and Thyme', 'North Bakery'];

/**
 * An overlay that stays open while "Keep open" is on, so the review toolbar can comment on it:
 * clicks outside it (the toolbar's) do not close it then.
 */
function useKeepOpen() {
    const [keep, setKeep] = useState(false);
    const [open, setOpen] = useState(false);
    return {
        open: keep || open,
        onOpenChange: (next: boolean) => {
            if (!keep) setOpen(next);
        },
        keep,
        setKeep: (next: boolean) => {
            setKeep(next);
            setOpen(next);
        }
    };
}

function KeepOpenSwitch({ keep, setKeep }: { keep: boolean; setKeep: (next: boolean) => void }) {
    const id = useId();
    return (
        <div className="flex items-center gap-2">
            <Switch id={id} size="sm" checked={keep} onCheckedChange={setKeep} />
            <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">Keep open</Label>
        </div>
    );
}

/** A specimen's cell for an overlay: the trigger at the top, room under it for what opens */
function OverlayStage({ children, keepOpen, className }: { children: ReactNode; keepOpen?: ReactNode; className?: string }) {
    return (
        <div className={cn('flex min-h-56 w-full flex-col items-start justify-between gap-4 self-stretch', className)}>
            <div className="flex flex-wrap items-center gap-3">{children}</div>
            {keepOpen}
        </div>
    );
}

function ButtonSpecimen() {
    return (
        <Specimen id="ui-button">
            <State label="Default"><Button>Create project</Button></State>
            <State label="Outline"><Button variant="outline">Open review</Button></State>
            <State label="Secondary"><Button variant="secondary">Copy link</Button></State>
            <State label="Ghost"><Button variant="ghost">Cancel</Button></State>
            <State label="Destructive"><Button variant="destructive">Delete project</Button></State>
            <State label="Link"><Button variant="link">View all comments</Button></State>
            <State label="Sizes">
                <Button size="xs">Extra small</Button>
                <Button size="sm">Small</Button>
                <Button>Default</Button>
                <Button size="lg">Large</Button>
            </State>
            <State label="With icon">
                <Button><PlusIcon data-icon="inline-start" />New project</Button>
                <Button variant="outline">Next<ChevronRightIcon data-icon="inline-end" /></Button>
            </State>
            <State label="Icon only">
                <Button size="icon-xs" variant="ghost" aria-label="Settings, extra small"><SettingsIcon /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Settings, small"><SettingsIcon /></Button>
                <Button size="icon" variant="outline" aria-label="Settings"><SettingsIcon /></Button>
                <Button size="icon-lg" variant="outline" aria-label="Settings, large"><SettingsIcon /></Button>
            </State>
            <State label="Disabled">
                <Button disabled>Create project</Button>
                <Button variant="outline" disabled>Open review</Button>
            </State>
            <State label="Pending"><Button disabled><Spinner data-icon="inline-start" />Saving</Button></State>
        </Specimen>
    );
}

function BadgeSpecimen() {
    return (
        <Specimen id="ui-badge">
            <State label="Default"><Badge>New</Badge></State>
            <State label="Secondary"><Badge variant="secondary">Bug report</Badge></State>
            <State label="Outline"><Badge variant="outline">Desktop</Badge></State>
            <State label="Destructive"><Badge variant="destructive">Failed</Badge></State>
            <State label="Ghost"><Badge variant="ghost">Draft</Badge></State>
            <State label="With icon"><Badge variant="outline"><GlobeIcon data-icon="inline-start" />cafelumen.com</Badge></State>
        </Specimen>
    );
}

function InputSpecimen() {
    const id = useId();
    return (
        <Specimen id="ui-input">
            <State label="Empty"><Input aria-label="Project name, empty" placeholder="Project name" /></State>
            <State label="Filled"><Input aria-label="Project name, filled" defaultValue="Cafe Lumen" /></State>
            <State label="Disabled"><Input aria-label="Project name, disabled" defaultValue="Cafe Lumen" disabled /></State>
            <State label="Invalid"><Input aria-label="Site address, invalid" aria-invalid defaultValue="cafe lumen" /></State>
            <State label="With label">
                <div className="flex w-full flex-col gap-2">
                    <Label htmlFor={`${id}-email`}>Email</Label>
                    <Input id={`${id}-email`} type="email" placeholder="you@company.com" />
                </div>
            </State>
            <State label="Read only"><Input aria-label="Project id" className="font-mono" readOnly defaultValue="uier00000002" /></State>
        </Specimen>
    );
}

function TextareaSpecimen() {
    return (
        <Specimen id="ui-textarea">
            <State label="Empty"><Textarea aria-label="Reply, empty" placeholder="Write a reply" /></State>
            <State label="Filled"><Textarea aria-label="Reply, filled" defaultValue="The opening hours wrap on small screens. Can we keep them on one line?" /></State>
            <State label="Disabled"><Textarea aria-label="Reply, disabled" disabled defaultValue="Replies are off for this thread." /></State>
            <State label="Invalid"><Textarea aria-label="Reply, invalid" aria-invalid defaultValue="" placeholder="Write a reply" /></State>
        </Specimen>
    );
}

function InputGroupSpecimen() {
    return (
        <Specimen id="ui-input-group">
            <State label="Icon at the start">
                <InputGroup>
                    <InputGroupInput aria-label="Search comments" placeholder="Search comments" />
                    <InputGroupAddon><SearchIcon /></InputGroupAddon>
                </InputGroup>
            </State>
            <State label="Text and button">
                <InputGroup>
                    <InputGroupInput aria-label="Site address" placeholder="cafelumen.com" />
                    <InputGroupAddon><InputGroupText>https://</InputGroupText></InputGroupAddon>
                    <InputGroupAddon align="inline-end"><InputGroupButton aria-label="Copy" size="icon-xs"><CopyIcon /></InputGroupButton></InputGroupAddon>
                </InputGroup>
            </State>
            <State label="Shortcut at the end">
                <InputGroup>
                    <InputGroupInput aria-label="Jump to" placeholder="Jump to" />
                    <InputGroupAddon align="inline-end"><Kbd>/</Kbd></InputGroupAddon>
                </InputGroup>
            </State>
        </Specimen>
    );
}

function FieldSpecimen() {
    const id = useId();
    return (
        <Specimen id="ui-field" columns={2}>
            <State label="Label and description">
                <Field>
                    <FieldLabel htmlFor={`${id}-name`}>Project name</FieldLabel>
                    <Input id={`${id}-name`} defaultValue="Cafe Lumen" />
                    <FieldDescription>Reviewers see it in the toolbar.</FieldDescription>
                </Field>
            </State>
            <State label="Error">
                <Field data-invalid>
                    <FieldLabel htmlFor={`${id}-address`}>Site address</FieldLabel>
                    <Input id={`${id}-address`} aria-invalid defaultValue="cafe lumen" />
                    <FieldError>Enter an address like cafelumen.com.</FieldError>
                </Field>
            </State>
            <State label="Horizontal">
                <Field orientation="horizontal">
                    <Checkbox id={`${id}-notify`} defaultChecked />
                    <FieldContent>
                        <FieldLabel htmlFor={`${id}-notify`}>Email me about replies</FieldLabel>
                        <FieldDescription>One email per thread, at most once an hour.</FieldDescription>
                    </FieldContent>
                </Field>
            </State>
            <State label="Field set">
                <FieldSet>
                    <FieldLegend>Notifications</FieldLegend>
                    <FieldGroup className="gap-3">
                        <Field orientation="horizontal">
                            <Switch id={`${id}-mentions`} defaultChecked />
                            <FieldLabel htmlFor={`${id}-mentions`}>Mentions</FieldLabel>
                        </Field>
                        <Field orientation="horizontal">
                            <Switch id={`${id}-digest`} />
                            <FieldLabel htmlFor={`${id}-digest`}>Daily digest</FieldLabel>
                        </Field>
                    </FieldGroup>
                </FieldSet>
            </State>
        </Specimen>
    );
}

function CheckboxSpecimen() {
    const id = useId();
    const checkbox = (suffix: string, label: string, props: React.ComponentProps<typeof Checkbox>) => (
        <div className="flex items-center gap-2">
            <Checkbox id={`${id}-${suffix}`} {...props} />
            <Label htmlFor={`${id}-${suffix}`}>{label}</Label>
        </div>
    );
    return (
        <Specimen id="ui-checkbox">
            <State label="Unchecked">{checkbox('off', 'Show resolved', {})}</State>
            <State label="Checked">{checkbox('on', 'Show resolved', { defaultChecked: true })}</State>
            <State label="Indeterminate">{checkbox('some', 'Select all', { indeterminate: true })}</State>
            <State label="Disabled">{checkbox('disabled', 'Show archived', { disabled: true })}</State>
            <State label="Disabled and checked">{checkbox('disabled-on', 'Show archived', { disabled: true, defaultChecked: true })}</State>
            <State label="Invalid">{checkbox('invalid', 'I accept the terms', { 'aria-invalid': true })}</State>
        </Specimen>
    );
}

function RadioGroupSpecimen() {
    const id = useId();
    return (
        <Specimen id="ui-radio-group" columns={2}>
            <State label="Default">
                <RadioGroup defaultValue="member" aria-label="Role">
                    {roles.map(role => (
                        <div key={role.value} className="flex items-center gap-2">
                            <RadioGroupItem value={role.value} id={`${id}-${role.value}`} />
                            <Label htmlFor={`${id}-${role.value}`}>{role.label}</Label>
                        </div>
                    ))}
                </RadioGroup>
            </State>
            <State label="Disabled option">
                <RadioGroup defaultValue="member" aria-label="Role, one option disabled">
                    {roles.map(role => (
                        <div key={role.value} className="flex items-center gap-2">
                            <RadioGroupItem value={role.value} id={`${id}-d-${role.value}`} disabled={role.value === 'admin'} />
                            <Label htmlFor={`${id}-d-${role.value}`}>{role.label}</Label>
                        </div>
                    ))}
                </RadioGroup>
            </State>
        </Specimen>
    );
}

function SwitchSpecimen() {
    const id = useId();
    const item = (suffix: string, label: string, props: React.ComponentProps<typeof Switch>) => (
        <div className="flex items-center gap-2">
            <Switch id={`${id}-${suffix}`} {...props} />
            <Label htmlFor={`${id}-${suffix}`}>{label}</Label>
        </div>
    );
    return (
        <Specimen id="ui-switch">
            <State label="Off">{item('off', 'AI titles', {})}</State>
            <State label="On">{item('on', 'AI titles', { defaultChecked: true })}</State>
            <State label="Small">{item('sm', 'AI titles', { size: 'sm', defaultChecked: true })}</State>
            <State label="Disabled">{item('disabled', 'AI titles', { disabled: true })}</State>
            <State label="Disabled and on">{item('disabled-on', 'AI titles', { disabled: true, defaultChecked: true })}</State>
        </Specimen>
    );
}

function ToggleSpecimen() {
    return (
        <Specimen id="ui-toggle">
            <State label="Off"><Toggle><ArchiveIcon />Resolved</Toggle></State>
            <State label="On"><Toggle defaultPressed><ArchiveIcon />Resolved</Toggle></State>
            <State label="Outline"><Toggle variant="outline"><ArchiveIcon />Resolved</Toggle></State>
            <State label="Small"><Toggle size="sm"><ArchiveIcon />Resolved</Toggle></State>
            <State label="Disabled"><Toggle disabled><ArchiveIcon />Resolved</Toggle></State>
        </Specimen>
    );
}

function ToggleGroupSpecimen() {
    return (
        <Specimen id="ui-toggle-group">
            <State label="Single choice">
                <ToggleGroup defaultValue={['list']} aria-label="View">
                    <ToggleGroupItem value="list" aria-label="List"><ListIcon /></ToggleGroupItem>
                    <ToggleGroupItem value="board" aria-label="Board"><LayoutGridIcon /></ToggleGroupItem>
                </ToggleGroup>
            </State>
            <State label="Outline">
                <ToggleGroup variant="outline" defaultValue={['open']} aria-label="Status, outline">
                    <ToggleGroupItem value="open">Open</ToggleGroupItem>
                    <ToggleGroupItem value="done">Done</ToggleGroupItem>
                    <ToggleGroupItem value="all">All</ToggleGroupItem>
                </ToggleGroup>
            </State>
            <State label="Attached">
                <ToggleGroup variant="outline" spacing={0} defaultValue={['week']} aria-label="Period">
                    <ToggleGroupItem value="day">Day</ToggleGroupItem>
                    <ToggleGroupItem value="week">Week</ToggleGroupItem>
                    <ToggleGroupItem value="month">Month</ToggleGroupItem>
                </ToggleGroup>
            </State>
        </Specimen>
    );
}

function SelectSpecimen() {
    const kept = useKeepOpen();
    const role = (label: string, props: Omit<React.ComponentProps<typeof Select>, 'items'>, trigger?: React.ComponentProps<typeof SelectTrigger>, kept = false) => (
        <Select items={roles} {...props}>
            <SelectTrigger aria-label={label} className="w-40" {...trigger}><SelectValue placeholder="Choose a role" /></SelectTrigger>
            {/* Kept open (non-modal, the page scrolls), it opens under its trigger: over it, it would not follow the scroll */}
            <SelectContent alignItemWithTrigger={!kept} data-anchor={kept ? 'ui-select/open-popup' : undefined}>
                <SelectGroup>{roles.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup>
            </SelectContent>
        </Select>
    );
    return (
        <Specimen id="ui-select">
            <State label="Placeholder">{role('Role, empty', {})}</State>
            <State label="With value">{role('Role', { defaultValue: 'admin' })}</State>
            <State label="Small">{role('Role, small', { defaultValue: 'member' }, { size: 'sm' })}</State>
            <State label="Disabled">{role('Role, disabled', { defaultValue: 'member', disabled: true })}</State>
            <State label="Invalid">{role('Role, invalid', {}, { 'aria-invalid': true })}</State>
            <State label="Open">
                <OverlayStage keepOpen={<KeepOpenSwitch keep={kept.keep} setKeep={kept.setKeep} />}>
                    {role('Role, open', { defaultValue: 'member', open: kept.open, onOpenChange: kept.onOpenChange, modal: false }, undefined, true)}
                </OverlayStage>
            </State>
        </Specimen>
    );
}

function AutocompleteSpecimen() {
    const id = useId();
    return (
        <Specimen id="ui-autocomplete" columns={2}>
            <State label="Suggestions" className="items-start">
                <div className="flex min-h-48 w-full flex-col gap-2">
                    <Label htmlFor={`${id}-client`}>Client</Label>
                    <Autocomplete items={clients} openOnInputClick>
                        <AutocompleteInput id={`${id}-client`} placeholder="Choose a client or type a new one" triggerLabel="Show clients" />
                        <AutocompleteContent>
                            <AutocompleteEmpty><PlusIcon aria-hidden="true" /><span>New client</span></AutocompleteEmpty>
                            <AutocompleteList>
                                {(client: string) => <AutocompleteItem key={client} value={client}>{client}</AutocompleteItem>}
                            </AutocompleteList>
                        </AutocompleteContent>
                    </Autocomplete>
                </div>
            </State>
            <State label="Disabled" className="items-start">
                <div className="flex w-full flex-col gap-2">
                    <Label htmlFor={`${id}-client-disabled`}>Client</Label>
                    <Autocomplete items={clients} defaultValue="Cafe Lumen" disabled>
                        <AutocompleteInput id={`${id}-client-disabled`} disabled triggerLabel="Show clients" />
                    </Autocomplete>
                </div>
            </State>
        </Specimen>
    );
}

function TabsSpecimen() {
    const tabs = (variant: 'default' | 'line', label: string, orientation: 'horizontal' | 'vertical' = 'horizontal') => (
        <Tabs defaultValue="comments" orientation={orientation} className="w-full">
            <TabsList variant={variant} aria-label={label}>
                <TabsTrigger value="comments">Comments</TabsTrigger>
                <TabsTrigger value="files">Files</TabsTrigger>
                <TabsTrigger value="settings" disabled>Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="comments" className="text-sm text-muted-foreground">12 open threads on 4 pages.</TabsContent>
            <TabsContent value="files" className="text-sm text-muted-foreground">No files yet.</TabsContent>
        </Tabs>
    );
    return (
        <Specimen id="ui-tabs">
            <State label="Default">{tabs('default', 'Project, default tabs')}</State>
            <State label="Line">{tabs('line', 'Project, line tabs')}</State>
            <State label="Vertical">{tabs('line', 'Project, vertical tabs', 'vertical')}</State>
        </Specimen>
    );
}

function CardSpecimen() {
    return (
        <Specimen id="ui-card">
            <State label="Default">
                <Card className="w-full">
                    <CardHeader>
                        <CardTitle>Cafe Lumen</CardTitle>
                        <CardDescription>cafelumen.com · 12 open threads</CardDescription>
                    </CardHeader>
                    <CardContent className="text-muted-foreground">Last comment 4 minutes ago on /menu.</CardContent>
                </Card>
            </State>
            <State label="With action and footer">
                <Card className="w-full">
                    <CardHeader>
                        <CardTitle>Install the toolbar</CardTitle>
                        <CardDescription>Add one script tag to the site.</CardDescription>
                        <CardAction><Button variant="ghost" size="icon-sm" aria-label="Dismiss install card"><Trash2Icon /></Button></CardAction>
                    </CardHeader>
                    <CardFooter className="justify-end gap-2 border-t">
                        <Button variant="outline" size="sm">Later</Button>
                        <Button size="sm">Copy snippet</Button>
                    </CardFooter>
                </Card>
            </State>
            <State label="Small">
                <Card size="sm" className="w-full">
                    <CardHeader>
                        <CardTitle>Harbor Kitchen</CardTitle>
                        <CardDescription>3 open threads</CardDescription>
                    </CardHeader>
                </Card>
            </State>
        </Specimen>
    );
}

function AlertSpecimen() {
    return (
        <Specimen id="ui-alert">
            <State label="Default">
                <Alert>
                    <InboxIcon />
                    <AlertTitle>The toolbar is installed</AlertTitle>
                    <AlertDescription>Comments from cafelumen.com arrive here.</AlertDescription>
                </Alert>
            </State>
            <State label="Destructive">
                <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle>The site did not answer</AlertTitle>
                    <AlertDescription>Check the address and try again.</AlertDescription>
                </Alert>
            </State>
            <State label="With action">
                <Alert>
                    <GlobeIcon />
                    <AlertTitle>New site address</AlertTitle>
                    <AlertDescription>staging.cafelumen.com sent its first comment.</AlertDescription>
                    <AlertAction><Button size="xs" variant="outline">Add</Button></AlertAction>
                </Alert>
            </State>
        </Specimen>
    );
}

function AvatarSpecimen() {
    return (
        <Specimen id="ui-avatar">
            <State label="Initials"><Avatar><AvatarFallback>LE</AvatarFallback></Avatar></State>
            <State label="Picture"><Avatar><AvatarImage src="/apple-touch-icon.png" alt="" /><AvatarFallback>U</AvatarFallback></Avatar></State>
            <State label="Sizes">
                <Avatar size="sm"><AvatarFallback>S</AvatarFallback></Avatar>
                <Avatar><AvatarFallback>M</AvatarFallback></Avatar>
                <Avatar size="lg"><AvatarFallback>L</AvatarFallback></Avatar>
            </State>
            <State label="With badge"><Avatar><AvatarFallback>LE</AvatarFallback><AvatarBadge /></Avatar></State>
            <State label="Group">
                <AvatarGroup>
                    <Avatar><AvatarFallback>LE</AvatarFallback></Avatar>
                    <Avatar><AvatarFallback>MK</AvatarFallback></Avatar>
                    <Avatar><AvatarFallback>TS</AvatarFallback></Avatar>
                    <AvatarGroupCount>+4</AvatarGroupCount>
                </AvatarGroup>
            </State>
        </Specimen>
    );
}

function BreadcrumbSpecimen() {
    return (
        <Specimen id="ui-breadcrumb" columns={2}>
            <State label="Two levels">
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem><BreadcrumbLink href="#ui-breadcrumb">Projects</BreadcrumbLink></BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem><BreadcrumbPage>Cafe Lumen</BreadcrumbPage></BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </State>
            <State label="Collapsed">
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem><BreadcrumbLink href="#ui-breadcrumb">Projects</BreadcrumbLink></BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem><BreadcrumbEllipsis /></BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem><BreadcrumbPage>Settings</BreadcrumbPage></BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
            </State>
        </Specimen>
    );
}

function ItemSpecimen() {
    const item = (variant: 'default' | 'outline' | 'muted', size: 'default' | 'sm' | 'xs' = 'default') => (
        <Item variant={variant} size={size} className="w-full">
            <ItemMedia variant="icon"><FolderIcon /></ItemMedia>
            <ItemContent>
                <ItemTitle>Cafe Lumen</ItemTitle>
                <ItemDescription>cafelumen.com</ItemDescription>
            </ItemContent>
            <ItemActions><Button variant="outline" size="sm">Open</Button></ItemActions>
        </Item>
    );
    return (
        <Specimen id="ui-item">
            <State label="Default">{item('default')}</State>
            <State label="Outline">{item('outline')}</State>
            <State label="Muted">{item('muted')}</State>
            <State label="Small">{item('outline', 'sm')}</State>
            <State label="Extra small">{item('outline', 'xs')}</State>
        </Specimen>
    );
}

function EmptySpecimen() {
    return (
        <Specimen id="ui-empty" columns={2}>
            <State label="With icon and action">
                <Empty>
                    <EmptyHeader>
                        <EmptyMedia variant="icon"><MessageSquareIcon /></EmptyMedia>
                        <EmptyTitle>No comments yet</EmptyTitle>
                        <EmptyDescription>Open the site with review on and click what you mean.</EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent><Button variant="outline" size="sm">Open review</Button></EmptyContent>
                </Empty>
            </State>
            <State label="Bordered">
                <Empty className="border border-dashed">
                    <EmptyHeader>
                        <EmptyTitle>No results</EmptyTitle>
                        <EmptyDescription>Nothing matches these filters.</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </State>
        </Specimen>
    );
}

function TableSpecimen() {
    const rows = [
        { page: '/menu', open: 5, done: 12 },
        { page: '/reservations', open: 2, done: 4 },
        { page: '/about', open: 0, done: 3 }
    ];
    return (
        <Specimen id="ui-table" columns={1}>
            <State label="Default">
                <Table>
                    <TableCaption>Threads per page</TableCaption>
                    <TableHeader>
                        <TableRow><TableHead>Page</TableHead><TableHead className="text-right">Open</TableHead><TableHead className="text-right">Done</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map(row => (
                            <TableRow key={row.page}>
                                <TableCell className="font-mono">{row.page}</TableCell>
                                <TableCell className="text-right tabular-nums">{row.open}</TableCell>
                                <TableCell className="text-right tabular-nums">{row.done}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </State>
        </Specimen>
    );
}

function KbdSpecimen() {
    return (
        <Specimen id="ui-kbd">
            <State label="Single key"><Kbd>C</Kbd><Kbd>?</Kbd><Kbd>Esc</Kbd></State>
            <State label="Combination"><KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup></State>
            <State label="In a button"><Button variant="outline" size="sm">Comment<Kbd data-icon="inline-end">C</Kbd></Button></State>
        </Specimen>
    );
}

function ProgressSpecimen() {
    return (
        <Specimen id="ui-progress">
            <State label="Empty"><Progress value={0} aria-label="Upload, not started" className="w-full" /></State>
            <State label="Part way"><Progress value={40} aria-label="Upload" className="w-full" /></State>
            <State label="Complete"><Progress value={100} aria-label="Upload, complete" className="w-full" /></State>
            <State label="With label">
                <Progress value={72} className="w-full">
                    <ProgressLabel>Monthly comments</ProgressLabel>
                    <ProgressValue />
                </Progress>
            </State>
        </Specimen>
    );
}

function LoadingSpecimen() {
    return (
        <Specimen id="ui-loading">
            <State label="Spinner"><Spinner /><Spinner className="size-6" /></State>
            <State label="Skeleton lines">
                <div className="flex w-full flex-col gap-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                </div>
            </State>
            <State label="Skeleton row">
                <div className="flex w-full items-center gap-3">
                    <Skeleton className="size-8 rounded-full" />
                    <div className="flex flex-1 flex-col gap-2">
                        <Skeleton className="h-3.5 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                    </div>
                </div>
            </State>
        </Specimen>
    );
}

function SeparatorSpecimen() {
    return (
        <Specimen id="ui-separator" columns={2}>
            <State label="Horizontal">
                <div className="flex w-full flex-col gap-3 text-sm">
                    <span>Comments</span>
                    <Separator />
                    <span>Files</span>
                </div>
            </State>
            <State label="Vertical">
                <div className="flex h-5 items-center gap-3 text-sm">
                    <span>12 open</span>
                    <Separator orientation="vertical" />
                    <span>4 done</span>
                </div>
            </State>
        </Specimen>
    );
}

function CollapsibleSpecimen() {
    const section = (defaultOpen: boolean) => (
        <Collapsible defaultOpen={defaultOpen} className="group/section flex w-full flex-col gap-2">
            <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="justify-start" />}>
                <ChevronRightIcon data-icon="inline-start" className="transition-transform group-data-panel-open/section:rotate-90" />
                Done
            </CollapsibleTrigger>
            <CollapsibleContent className="pl-7 text-sm text-muted-foreground">4 threads marked as done this week.</CollapsibleContent>
        </Collapsible>
    );
    return (
        <Specimen id="ui-collapsible" columns={2}>
            <State label="Closed" className="items-start">{section(false)}</State>
            <State label="Open" className="items-start">{section(true)}</State>
        </Specimen>
    );
}

function TooltipSpecimen() {
    const kept = useKeepOpen();
    return (
        <Specimen id="ui-tooltip" columns={2}>
            <State label="On hover or focus">
                <OverlayStage>
                    <Tooltip>
                        <TooltipTrigger render={<Button variant="outline" size="icon" aria-label="Archive" />}><ArchiveIcon /></TooltipTrigger>
                        <TooltipContent side="bottom">Archive</TooltipContent>
                    </Tooltip>
                </OverlayStage>
            </State>
            <State label="Open">
                <OverlayStage keepOpen={<KeepOpenSwitch keep={kept.keep} setKeep={kept.setKeep} />}>
                    <Tooltip open={kept.open} onOpenChange={kept.onOpenChange}>
                        <TooltipTrigger render={<Button variant="outline" size="icon" aria-label="New comment" />}><PlusIcon /></TooltipTrigger>
                        <TooltipContent side="bottom" data-anchor="ui-tooltip/open-popup">New comment<Kbd>C</Kbd></TooltipContent>
                    </Tooltip>
                </OverlayStage>
            </State>
        </Specimen>
    );
}

function PopoverSpecimen() {
    const kept = useKeepOpen();
    const content = (anchor?: string) => (
        <PopoverContent align="start" data-anchor={anchor}>
            <PopoverHeader>
                <PopoverTitle>Share review link</PopoverTitle>
                <PopoverDescription>Anyone with the link can comment as a guest.</PopoverDescription>
            </PopoverHeader>
            <Button size="sm"><CopyIcon data-icon="inline-start" />Copy link</Button>
        </PopoverContent>
    );
    return (
        <Specimen id="ui-popover" columns={2}>
            <State label="Closed">
                <OverlayStage>
                    <Popover>
                        <PopoverTrigger render={<Button variant="outline" />}>Share</PopoverTrigger>
                        {content()}
                    </Popover>
                </OverlayStage>
            </State>
            <State label="Open">
                <OverlayStage keepOpen={<KeepOpenSwitch keep={kept.keep} setKeep={kept.setKeep} />}>
                    <Popover open={kept.open} onOpenChange={kept.onOpenChange}>
                        <PopoverTrigger render={<Button variant="outline" />}>Share</PopoverTrigger>
                        {content('ui-popover/open-popup')}
                    </Popover>
                </OverlayStage>
            </State>
        </Specimen>
    );
}

function DropdownMenuSpecimen() {
    const kept = useKeepOpen();
    const [showResolved, setShowResolved] = useState(true);
    const [sort, setSort] = useState('newest');
    const content = (anchor?: string) => (
        <DropdownMenuContent className="w-56" data-anchor={anchor}>
            <DropdownMenuGroup>
                <DropdownMenuLabel>Thread</DropdownMenuLabel>
                <DropdownMenuItem><UserPlusIcon />Assign<DropdownMenuShortcut>A</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuItem><CopyIcon />Copy link</DropdownMenuItem>
                <DropdownMenuItem disabled><ArchiveIcon />Archive</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
                <DropdownMenuCheckboxItem checked={showResolved} onCheckedChange={setShowResolved}>Show resolved</DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
                <DropdownMenuLabel>Sort</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
                    <DropdownMenuRadioItem value="newest">Newest first</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="oldest">Oldest first</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive"><Trash2Icon />Delete</DropdownMenuItem>
        </DropdownMenuContent>
    );
    return (
        <Specimen id="ui-dropdown-menu" columns={2}>
            <State label="Closed">
                <OverlayStage>
                    <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="outline" />}>Actions</DropdownMenuTrigger>
                        {content()}
                    </DropdownMenu>
                </OverlayStage>
            </State>
            <State label="Open">
                <OverlayStage className="min-h-96" keepOpen={<KeepOpenSwitch keep={kept.keep} setKeep={kept.setKeep} />}>
                    <DropdownMenu open={kept.open} onOpenChange={kept.onOpenChange} modal={false}>
                        <DropdownMenuTrigger render={<Button variant="outline" />}>Actions</DropdownMenuTrigger>
                        {content('ui-dropdown-menu/open-popup')}
                    </DropdownMenu>
                </OverlayStage>
            </State>
        </Specimen>
    );
}

function DialogSpecimen() {
    const id = useId();
    return (
        <Specimen id="ui-dialog" columns={2}>
            <State label="Form">
                <Dialog>
                    <DialogTrigger render={<Button variant="outline" />}>New project</DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>New project</DialogTitle>
                            <DialogDescription>One project per site. You can add more addresses later.</DialogDescription>
                        </DialogHeader>
                        <Field>
                            <FieldLabel htmlFor={`${id}-site`}>Site address</FieldLabel>
                            <Input id={`${id}-site`} placeholder="cafelumen.com" />
                        </Field>
                        <DialogFooter>
                            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                            <Button>Create project</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </State>
            <State label="Without close button">
                <Dialog>
                    <DialogTrigger render={<Button variant="outline" />}>Keyboard shortcuts</DialogTrigger>
                    <DialogContent showCloseButton={false}>
                        <DialogHeader>
                            <DialogTitle>Keyboard shortcuts</DialogTitle>
                            <DialogDescription>Press <Kbd>?</Kbd> anywhere in the app to see them.</DialogDescription>
                        </DialogHeader>
                        <DialogFooter showCloseButton />
                    </DialogContent>
                </Dialog>
            </State>
        </Specimen>
    );
}

function AlertDialogSpecimen() {
    const [open, setOpen] = useState(false);
    const [smallOpen, setSmallOpen] = useState(false);
    return (
        <Specimen id="ui-alert-dialog" columns={2}>
            <State label="Default">
                <AlertDialog open={open} onOpenChange={setOpen}>
                    <AlertDialogTrigger render={<Button variant="outline" />}>Delete project</AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete Cafe Lumen?</AlertDialogTitle>
                            <AlertDialogDescription>Its 16 threads and their screenshots are deleted for everyone. This cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => setOpen(false)}>Delete project</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </State>
            <State label="Small with media">
                <AlertDialog open={smallOpen} onOpenChange={setSmallOpen}>
                    <AlertDialogTrigger render={<Button variant="outline" />}>Archive all</AlertDialogTrigger>
                    <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                            <AlertDialogMedia><ArchiveIcon /></AlertDialogMedia>
                            <AlertDialogTitle>Archive 4 threads?</AlertDialogTitle>
                            <AlertDialogDescription>You can find them under Archived.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => setSmallOpen(false)}>Archive</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </State>
        </Specimen>
    );
}

function SheetSpecimen() {
    const sheet = (side: 'right' | 'left' | 'bottom', label: string) => (
        <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>{label}</SheetTrigger>
            <SheetContent side={side}>
                <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                    <SheetDescription>Show the threads that match all of these.</SheetDescription>
                </SheetHeader>
                <SheetFooter>
                    <SheetClose render={<Button />}>Show 12 threads</SheetClose>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
    return (
        <Specimen id="ui-sheet">
            <State label="Right">{sheet('right', 'Open from the right')}</State>
            <State label="Left">{sheet('left', 'Open from the left')}</State>
            <State label="Bottom">{sheet('bottom', 'Open from the bottom')}</State>
        </Specimen>
    );
}

function ToastSpecimen() {
    return (
        <Specimen id="ui-toast">
            <State label="Message"><Button variant="outline" onClick={() => toast('Link copied')}>Show</Button></State>
            <State label="Success"><Button variant="outline" onClick={() => toast.success('Comment deleted')}>Show</Button></State>
            <State label="Error"><Button variant="outline" onClick={() => toast.error('Could not save. Try again.')}>Show</Button></State>
            <State label="Warning"><Button variant="outline" onClick={() => toast.warning('The page changed since this comment')}>Show</Button></State>
            <State label="Info"><Button variant="outline" onClick={() => toast.info('Comments sync every minute')}>Show</Button></State>
            <State label="With action">
                <Button variant="outline" onClick={() => toast('4 threads archived', { action: { label: 'Undo', onClick: () => toast('Archive undone') } })}>Show</Button>
            </State>
        </Specimen>
    );
}

function SidebarSpecimen() {
    return (
        <Specimen id="ui-sidebar" columns={1}>
            <State label="Open">
                <SidebarProvider className="min-h-0 w-auto">
                    <Sidebar collapsible="none" className="h-auto rounded-xl border">
                        <SidebarHeader>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton size="lg"><Avatar size="sm"><AvatarFallback>C</AvatarFallback></Avatar>Cafe Lumen workspace</SidebarMenuButton>
                                </SidebarMenuItem>
                            </SidebarMenu>
                        </SidebarHeader>
                        <SidebarContent>
                            <SidebarGroup>
                                <SidebarGroupLabel>Projects</SidebarGroupLabel>
                                <SidebarMenu>
                                    <SidebarMenuItem>
                                        <SidebarMenuButton isActive><InboxIcon />My work</SidebarMenuButton>
                                        <SidebarMenuBadge>3</SidebarMenuBadge>
                                    </SidebarMenuItem>
                                    <SidebarMenuItem>
                                        <SidebarMenuButton><FolderIcon />cafelumen.com</SidebarMenuButton>
                                        <SidebarMenuSub>
                                            <SidebarMenuSubItem><SidebarMenuSubButton href="#ui-sidebar" isActive>Comments</SidebarMenuSubButton></SidebarMenuSubItem>
                                            <SidebarMenuSubItem><SidebarMenuSubButton href="#ui-sidebar">Settings</SidebarMenuSubButton></SidebarMenuSubItem>
                                        </SidebarMenuSub>
                                    </SidebarMenuItem>
                                </SidebarMenu>
                            </SidebarGroup>
                        </SidebarContent>
                    </Sidebar>
                </SidebarProvider>
            </State>
        </Specimen>
    );
}

export function AppKitSpecimens() {
    return (
        <TooltipProvider>
            <ButtonSpecimen />
            <BadgeSpecimen />
            <InputSpecimen />
            <TextareaSpecimen />
            <InputGroupSpecimen />
            <FieldSpecimen />
            <CheckboxSpecimen />
            <RadioGroupSpecimen />
            <SwitchSpecimen />
            <ToggleSpecimen />
            <ToggleGroupSpecimen />
            <SelectSpecimen />
            <AutocompleteSpecimen />
            <TabsSpecimen />
            <CardSpecimen />
            <AlertSpecimen />
            <AvatarSpecimen />
            <BreadcrumbSpecimen />
            <ItemSpecimen />
            <EmptySpecimen />
            <TableSpecimen />
            <KbdSpecimen />
            <ProgressSpecimen />
            <LoadingSpecimen />
            <SeparatorSpecimen />
            <CollapsibleSpecimen />
            <TooltipSpecimen />
            <PopoverSpecimen />
            <DropdownMenuSpecimen />
            <DialogSpecimen />
            <AlertDialogSpecimen />
            <SheetSpecimen />
            <ToastSpecimen />
            <SidebarSpecimen />
            <Toaster />
        </TooltipProvider>
    );
}
