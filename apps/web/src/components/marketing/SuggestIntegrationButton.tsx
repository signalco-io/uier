'use client';

import { Button } from '@uier/ui-primitives/Button';
import { openToolbarFeedback } from '../toolbar/ToolbarScript';

/** Opens the showcase toolbar's feedback form, where visitors suggest the next integration */
export function SuggestIntegrationButton() {
    return <Button variant="solid" size="lg" className="self-start" onClick={openToolbarFeedback}>Suggest an integration</Button>;
}
