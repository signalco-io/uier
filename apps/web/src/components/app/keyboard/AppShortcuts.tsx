'use client';

import { useAppI18n } from '@/src/lib/i18n/client';

import { createContext, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isSearchKey, isShortcutsHelpKey, sequenceTimeoutMs, shortcutLetter } from '@uier/toolbar/keyboard';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { setUrlSearchParams } from '@/src/hooks/use-url-search-params';
import { startToolbarComment } from '../../toolbar/ToolbarScript';
import { isShortcutTarget, useShortcutsEnabled } from './keys';
import { ShortcutsDialog } from './ShortcutsDialog';

const ShortcutsHelp = createContext<() => void>(() => {});

/** Opens the keyboard shortcuts dialog (the account menu's Keyboard shortcuts) */
export const useOpenShortcutsHelp = () => useContext(ShortcutsHelp);

/** The project whose pages these are: `/app/projects/<id>` and the pages below it */
function projectOf(pathname: string) {
    const id = /^\/app\/projects\/([^/]+)/.exec(pathname)?.[1];
    return id && id !== 'new' ? decodeURIComponent(id) : undefined;
}

/** A modifier pressed on its own, between G and the key after it */
const modifierKeys = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

/**
 * The app's shortcuts that work on every page: `?` shows them all (`ShortcutsDialog`), `/` goes to the
 * page's search (a field marked `data-shortcut-search`), C starts a comment with uier's own toolbar, and G followed by I, B,
 * M or P goes to the project's inbox or board, My work or Projects. The comments list and board, My
 * work and the open thread add their own (`useKeyShortcuts`). Single keys, so they can be turned off
 * (WCAG 2.1.4) and never act while typing, in a menu or a dialog, or in the review toolbar.
 */
export function AppShortcuts({ children }: { children: ReactNode }) {
    const { t } = useAppI18n();
    const router = useRouter();
    const pathname = usePathname();
    const enabled = useShortcutsEnabled();
    const [helpOpen, setHelpOpen] = useState(false);
    // When G was pressed: the key after it, soon after, says where to go
    const goPressed = useRef(0);

    const go = (letter: string) => {
        if (letter === 'm') router.push(KnownPages.AppMyWork);
        else if (letter === 'p') router.push(KnownPages.AppProjects);
        else if (letter === 'i' || letter === 'b') {
            // Only on a project's pages: the inbox and the board are its comments
            const project = projectOf(pathname);
            if (!project) return false;
            const href = KnownPageLinks.project(project);
            const view = letter === 'b' ? "board" : undefined;
            // On its comments the view changes in place, like the List and Board toggle, and keeps the filters
            if (pathname === href) setUrlSearchParams({ view, comment: undefined }, { history: 'push' });
            else router.push(`${href}${view ? '?view=board' : ''}#comments`);
        } else return false;
        return true;
    };

    // The key after G is taken before any control's own handling of it (M on a board card opens Move)
    const takeSequence = useEffectEvent((event: KeyboardEvent) => {
        const pressedAt = goPressed.current;
        if (!pressedAt || modifierKeys.has(event.key)) return;
        goPressed.current = 0;
        const letter = shortcutLetter(event);
        if (!letter || Date.now() - pressedAt > sequenceTimeoutMs || !isShortcutTarget(event) || !go(letter)) return;
        event.preventDefault();
        event.stopPropagation();
    });
    const takeKey = useEffectEvent((event: KeyboardEvent) => {
        if (!isShortcutTarget(event)) return;
        if (isShortcutsHelpKey(event)) {
            event.preventDefault();
            setHelpOpen(true);
            return;
        }
        if (isSearchKey(event)) {
            const search = [...document.querySelectorAll<HTMLInputElement>('[data-shortcut-search]')].find(field => field.checkVisibility());
            if (!search) return;
            event.preventDefault();
            search.focus();
            search.select();
            return;
        }
        const letter = shortcutLetter(event);
        if (letter === 'g') {
            event.preventDefault();
            goPressed.current = Date.now();
        } else if (letter === 'c') {
            event.preventDefault();
            startToolbarComment();
        }
    });
    useEffect(() => {
        if (!enabled) return;
        const sequence = (event: KeyboardEvent) => takeSequence(event);
        // Bubble phase on the document, after the page's own handlers: a key a control already used stays its own
        const key = (event: KeyboardEvent) => takeKey(event);
        window.addEventListener('keydown', sequence, true);
        document.addEventListener('keydown', key);
        return () => {
            window.removeEventListener('keydown', sequence, true);
            document.removeEventListener('keydown', key);
        };
    }, [enabled]);

    return (
        <ShortcutsHelp.Provider value={() => setHelpOpen(true)}>
            {children}
            <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
        </ShortcutsHelp.Provider>
    );
}
