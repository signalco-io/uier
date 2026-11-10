'use client';

import { useRef, useState, type ClipboardEvent } from 'react';
import { SuppliedImageError, suppliedScreenshot, type SuppliedImageProblem } from './suppliedScreenshot';

/** Memory only; the opaque key can identify an attempt without persisting image bytes. */
export type AttachedImage = { name: string; dataUrl: string; key?: string };

/**
 * The reviewer's own image for a comment, reply or feedback: chosen with the file picker or pasted
 * into the form, checked with the same formats and limits as saved evidence (suppliedScreenshot).
 * Held in memory only, never in draft or idempotency storage.
 */
export function useAttachedImage(initial?: AttachedImage, { pastedName = 'Pasted image' }: { pastedName?: string } = {}) {
    const [image, setStateImage] = useState(initial);
    // The image now, for a send that settles after later renders
    const imageRef = useRef(initial);
    const setImage = (next: AttachedImage | undefined) => { imageRef.current = next; setStateImage(next); };
    const [error, setError] = useState('');
    /** Why the image was refused (`suppliedScreenshot`), for a caller that words it itself; `read` when unknown */
    const [problem, setProblem] = useState<SuppliedImageProblem>();
    const [reading, setReading] = useState(false);
    const readingRef = useRef(false);
    const attach = async (file: Blob, name = file instanceof File && file.name ? file.name : pastedName) => {
        if (readingRef.current) return;
        readingRef.current = true;
        setReading(true);
        setError('');
        setProblem(undefined);
        try {
            setImage({ name, dataUrl: await suppliedScreenshot(file), key: Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('') });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'The image could not be read. Choose it again.');
            setProblem(cause instanceof SuppliedImageError ? cause.problem : 'read');
        } finally {
            readingRef.current = false;
            setReading(false);
        }
    };
    /** A pasted image file, unless text came with it (text is pasted as usual) */
    const handlePaste = (event: ClipboardEvent) => {
        const file = [...event.clipboardData.files].find(file => file.type.startsWith('image/'));
        if (!file || event.clipboardData.getData('text/plain')) return;
        event.preventDefault();
        void attach(file);
    };
    return {
        image,
        error,
        problem: error ? problem : undefined,
        reading,
        attach,
        handlePaste,
        remove: () => { setImage(undefined); setError(''); setProblem(undefined); },
        /** Whether an image is attached or being read now (not as of this render) */
        attached: () => Boolean(imageRef.current) || readingRef.current,
        /** A failed send's image, back in the form unless another one was attached meanwhile */
        restore: (sent: AttachedImage) => { if (!imageRef.current && !readingRef.current) setImage(sent); },
        /** The image the request sends: the reviewer's, else the automatic capture unless it was omitted */
        screenshotFor: (omitted: boolean, capture: Promise<string | undefined> | undefined) =>
            image ? image.dataUrl : omitted ? undefined : capture
    };
}
