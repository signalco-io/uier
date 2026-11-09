'use client';

import { MegaphoneIcon } from 'lucide-react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/src/components/ui/sidebar';
import { openToolbarFeedback } from '../../toolbar/ToolbarScript';
import { useKeyShortcutLabel } from '../keyboard/keys';

/**
 * Feedback on the app itself: uier's own toolbar opens on the page with its feedback form. On app
 * pages it is private to the person and the uier team (`isPrivateAppFeedback`).
 */
export function FeedbackButton() {
    const { isMobile, setOpenMobile } = useSidebar();
    // C opens it from anywhere in the app (`AppShortcuts`)
    const shortcut = useKeyShortcutLabel('C');

    const handleClick = () => {
        if (!isMobile) {
            openToolbarFeedback();
            return;
        }
        // The toolbar sits over the page: the navigation sheet makes way for it first, because once
        // it has closed it gives the focus back to its button, which would take it from the form
        setOpenMobile(false);
        const whenSheetClosed = () => document.querySelector('[data-slot="sidebar"][data-mobile="true"]')
            ? requestAnimationFrame(whenSheetClosed)
            : openToolbarFeedback();
        requestAnimationFrame(whenSheetClosed);
    };

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton tooltip="Give feedback" aria-keyshortcuts={shortcut} onClick={handleClick}>
                    <MegaphoneIcon />
                    <span>Give feedback</span>
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
