import { ApiError } from '../comments/http';
import type { ProofFormat, ProofManifest } from './model';

export type ProofSource = {
    bytes: Buffer;
    filename: string;
    contentType: string;
    signal: AbortSignal;
};
export type ProofSourceResult = {
    manifest: ProofManifest;
    artifacts: { id: string; contentType: string; bytes: Buffer }[];
    /** Private resource index. App-origin requests never serve prototype files. */
    resources?: Record<string, string>;
};
export type ProofSourceAdapter = {
    format: ProofFormat;
    contentTypes: readonly string[];
    ingest(source: ProofSource): Promise<ProofSourceResult>;
};

/** A terminal input/conversion error. Unknown errors remain retryable on the same upload. */
export class ProofSourceError extends ApiError {
    constructor(message: string) {
        super(422, 'invalid_request', message);
    }
}
