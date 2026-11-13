import type { RecordingProblem } from '@uier/toolbar/recordings';
import type { AppTranslator } from '@/src/lib/i18n/types';

/** Capture errors are stable codes; browser permission and device details never become UI copy. */
export function recordingProblemMessage(problem: RecordingProblem | undefined, t: AppTranslator) {
    switch (problem) {
        case 'unsupported': return t('Screen recording is unavailable in this browser. Upload a video instead.');
        case 'permission': return t('Screen sharing was cancelled or blocked. Try again or upload a video.');
        case 'type': return t('Choose an MP4 or WebM video.');
        case 'size': return t('Choose a video up to 25 MB.');
        case 'duration': return t('Choose a video up to 60 seconds.');
        case 'read': return t('This video could not be read. Choose another MP4 or WebM video.');
        case 'capture': return t('The recording could not be completed. Try again or upload a video.');
        case 'upload': return t('The recording could not be uploaded. Your draft is kept. Try sending again.');
        default: return undefined;
    }
}
