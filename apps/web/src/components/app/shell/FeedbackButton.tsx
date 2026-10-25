'use client';

import { MegaphoneIcon } from 'lucide-react';
import { openUierFeedback } from '@uier/toolbar/react';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/src/components/ui/sidebar';
import { toolbarScriptSrc } from '../../toolbar/ToolbarScript';

/**
 * Feedback on the app itself: uier's own toolbar opens on the page with its feedback form. On app
 * pages it is private to the person and the uier team (`isPrivateAppFeedback`).
 */
export function FeedbackButton() {
    const { isMobile, setOpenMobile } = useSidebar();

    // The app's own API, also when the development toolbar comes from its own server
    const openFeedback = () => openUierFeedback({ src: toolbarScriptSrc, apiUrl: window.location.origin });

    const handleClick = () => {
        if (!isMobile) {
            openFeedback();
            return;
        }
        // The toolbar sits over the page: the navigation sheet makes way for it first, because once
        // it has closed it gives the focus back to its button, which would take it from the form
        setOpenMobile(false);
        const whenSheetClosed = () => document.querySelector('[data-slot="sidebar"][data-mobile="true"]')
            ? requestAnimationFrame(whenSheetClosed)
            : openFeedback();
        requestAnimationFrame(whenSheetClosed);
    };

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <SidebarMenuButton tooltip="Give feedback" onClick={handleClick}>
                    <MegaphoneIcon />
                    <span>Give feedback</span>
                </SidebarMenuButton>
            </SidebarMenuItem>
        </SidebarMenu>
    );
}
