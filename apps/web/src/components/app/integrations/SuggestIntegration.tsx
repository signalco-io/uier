'use client';

import { MegaphoneIcon } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { openToolbarFeedback } from '../../toolbar/ToolbarScript';

/** Opens uier's own toolbar with its feedback form: private to the person and the uier team on app pages */
export function SuggestIntegration() {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed p-4">
            <p className="m-0 text-sm text-muted-foreground">Missing a tool your team works in? Tell us which one. Only you and the uier team see it.</p>
            <Button type="button" variant="outline" size="sm" onClick={openToolbarFeedback}><MegaphoneIcon data-icon="inline-start" />Suggest an integration</Button>
        </div>
    );
}
