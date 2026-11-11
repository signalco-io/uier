'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { Fragment, useId } from 'react';
import { setShortcutsEnabled } from '@uier/toolbar/keyboard';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/src/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/src/components/ui/field';
import { Kbd, KbdGroup } from '@/src/components/ui/kbd';
import { Switch } from '@/src/components/ui/switch';
import { useShortcutsEnabled } from './keys';

/** A key as it is printed, and its name where the print is a symbol (screen readers read "Up arrow") */
type Key = string | { print: string; name: string };
/** One action: its keys, each set an alternative (`or`), or one after the other (`then`) */
type Shortcut = { label: string; keys: Key[]; join?: 'or' | 'then'; letter?: boolean };

const up: Key = { print: '↑', name: 'Up arrow' };
const down: Key = { print: '↓', name: 'Down arrow' };
const left: Key = { print: '←', name: 'Left arrow' };
const right: Key = { print: '→', name: 'Right arrow' };

/**
 * Every shortcut of the app, by where it works. `letter`: a single-key shortcut, which the switch
 * turns off; the arrows, Enter and the keys with Ctrl or ⌘ always work. Keep it in step with the
 * handlers (`AppShortcuts`, the comments list and board, the open thread).
 */
const groups: { title: string; shortcuts: Shortcut[] }[] = [
    {
        title: 'Anywhere',
        shortcuts: [
            { label: 'Show keyboard shortcuts', keys: ['?'], letter: true },
            { label: 'Search', keys: ['/'], letter: true },
            { label: 'Comment on this page', keys: ['C'], letter: true },
            { label: 'Go to the project’s inbox', keys: ['G', 'I'], join: 'then', letter: true },
            { label: 'Go to the project’s board', keys: ['G', 'B'], join: 'then', letter: true },
            { label: 'Go to My work', keys: ['G', 'M'], join: 'then', letter: true },
            { label: 'Go to Projects', keys: ['G', 'P'], join: 'then', letter: true }
        ]
    },
    {
        title: 'Comments and My work',
        shortcuts: [
            { label: 'Next or previous row', keys: [down, up], join: 'or' },
            { label: 'Another column on the board', keys: [left, right], join: 'or' },
            { label: 'First or last', keys: ['Home', 'End'], join: 'or' },
            { label: 'Open the thread', keys: ['Enter'] },
            { label: 'Next thread', keys: ['J'], letter: true },
            { label: 'Previous thread', keys: ['K'], letter: true },
            { label: 'Select the row', keys: ['X'] },
            { label: 'Select the shown results', keys: ['mod', 'A'] },
            { label: 'Move a card to another column', keys: ['M'] },
            { label: 'Stop selecting, close the thread', keys: ['Esc'] }
        ]
    },
    {
        title: 'The open thread',
        shortcuts: [
            { label: 'Reply', keys: ['R'], letter: true },
            { label: 'Change status', keys: ['S'], letter: true },
            { label: 'Change assignee', keys: ['A'], letter: true },
            // In the reply box and a message being edited (MessageComposer); no hint under the box repeats them
            { label: 'Send or save a message', keys: ['Enter'] },
            { label: 'New line', keys: ['Shift', 'Enter'] },
            // Formatting in a message (`@uier/toolbar/editor`); Markdown typed as you write formats it too
            { label: 'Bold', keys: ['mod', 'B'] },
            { label: 'Italic', keys: ['mod', 'I'] },
            { label: 'Strikethrough', keys: ['mod', 'Shift', 'X'] },
            { label: 'Code', keys: ['mod', 'E'] },
            { label: 'Cancel an edit or close an empty reply', keys: ['Esc'] }
        ]
    },
    {
        title: 'Menus, tabs and lists',
        shortcuts: [
            { label: 'Next or previous item', keys: [down, up, left, right], join: 'or' },
            { label: 'First or last item', keys: ['Home', 'End'], join: 'or' },
            { label: 'Choose', keys: ['Enter', 'Space'], join: 'or' },
            { label: 'Close', keys: ['Esc'] }
        ]
    }
];

/** Ctrl, or ⌘ on Apple's systems (the dialog renders in the browser only, once opened) */
const modifierKey = (): Key => /Mac|iPhone|iPad/.test(navigator.userAgent) ? { print: '⌘', name: 'Command' } : 'Ctrl';

function Keys({ shortcut }: { shortcut: Shortcut }) {
    const { t } = useAppI18n();
    return (
        <KbdGroup>
            {shortcut.keys.map((key, index) => {
                const shown = key === 'mod' ? modifierKey() : key;
                return (
                    <Fragment key={index}>
                        {index > 0 && shortcut.join && <span className="text-xs text-muted-foreground">{t(shortcut.join)}</span>}
                        <Kbd>
                            {typeof shown === 'string' ? shown : <><span aria-hidden="true">{shown.print}</span><span className="sr-only">{t(shown.name)}</span></>}
                        </Kbd>
                    </Fragment>
                );
            })}
        </KbdGroup>
    );
}

/**
 * The keyboard shortcuts (`?`, or the account menu's Keyboard shortcuts), with the switch that turns
 * single-key shortcuts off in this browser (WCAG 2.1.4). The review toolbar reads the same switch.
 */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const { t } = useAppI18n();
    const enabled = useShortcutsEnabled();
    const switchId = useId();
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('Keyboard shortcuts')}</DialogTitle>
                    <DialogDescription>{t('They never act while you type in a field.')}</DialogDescription>
                </DialogHeader>
                {/* It scrolls on a short window: the keyboard can scroll it too */}
                <div role="region" aria-label={t('Keyboard shortcuts')} tabIndex={0}
                    className="-mx-6 grid min-h-0 gap-x-8 gap-y-5 overflow-y-auto px-6 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-2">
                    {groups.map(group => (
                        <section key={t(group.title)} aria-label={t(group.title)} className="flex flex-col gap-2">
                            <h3 className="m-0 text-xs font-medium text-muted-foreground">{t(group.title)}</h3>
                            <dl className="m-0 flex flex-col gap-1.5">
                                {group.shortcuts.map(shortcut => (
                                    <div key={t(shortcut.label)} className="flex min-h-6 items-center justify-between gap-3" data-shortcut-off={shortcut.letter && !enabled ? '' : undefined}>
                                        <dt className={shortcut.letter && !enabled ? 'text-muted-foreground' : undefined}>
                                            {t(shortcut.label)}
                                            {shortcut.letter && !enabled && <span className="sr-only">{t(' (off)')}</span>}
                                        </dt>
                                        <dd className="m-0 shrink-0"><Keys shortcut={shortcut} /></dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>
                <Field orientation="horizontal" className="border-t pt-4">
                    <FieldContent>
                        <FieldLabel htmlFor={switchId}>{t('Single-key shortcuts')}</FieldLabel>
                        <FieldDescription>{t('Turn them off if they get in the way of speech input. The arrow keys, Enter and Esc keep working. The review toolbar in this browser follows this too.')}</FieldDescription>
                    </FieldContent>
                    <Switch id={switchId} checked={enabled} onCheckedChange={checked => setShortcutsEnabled(checked)} />
                </Field>
            </DialogContent>
        </Dialog>
    );
}
