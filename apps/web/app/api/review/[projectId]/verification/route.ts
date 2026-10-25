import { reviewApiHandler } from '../../../../../src/lib/review/http';
import { createVerification } from '../../../../../src/lib/review/verification';

// Called only by the frame on this API's origin. No cross-origin preflight is offered.
export const POST = reviewApiHandler(createVerification, { comments: false, verifyWrites: false });
