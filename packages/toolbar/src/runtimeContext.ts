import { runtimeAdapters } from './adapters';
import type { ToolbarConfig, ToolbarMode } from './config';
import type { ToolbarRequest } from './openFeedback';
import type { ReviewSession } from './review';

/** `request`: what a `feedback` mode mount opens (its feedback form, or a new comment) */
export type MountToolbar = (mode: ToolbarMode, review: ReviewSession | null, request?: ToolbarRequest) => void;

type RuntimeContext = {
    config?: ToolbarConfig;
    projectSession?: { memory: Map<string, string>; initialReviewCode: string | null | undefined };
    installationCheck?: {
        nonce?: string;
        latest: { stage: 'loaded' | 'api' | 'ready' | 'failed'; code?: string };
        started: boolean;
        receiver?: { window: Window; origin: string };
    };
    mount?: MountToolbar;
};

// A property of the dynamically loaded script, never a named window global. Both classic
// scripts read it synchronously so host configuration and blocked storage survive the handoff.
export const runtimeContextKey = Symbol.for('uier.toolbar.context');
export type RuntimeScript = HTMLScriptElement & { [runtimeContextKey]?: RuntimeContext };
export const runtimeContext: RuntimeContext =
    runtimeAdapters() ? {} : (document.currentScript as RuntimeScript | null)?.[runtimeContextKey] ?? {};
