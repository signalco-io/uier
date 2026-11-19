import { attachPublicRecording, readPublicRecording } from '@/src/lib/recordings/routes';
export const GET = readPublicRecording;
// A finalized recording for a saved comment that has none: its author only
export const POST = attachPublicRecording;
