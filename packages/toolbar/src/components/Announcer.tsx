import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';

const AnnouncerContext = createContext<(message: string) => void>(() => { });

/** Announces a short message to screen readers (polite), e.g. "Comment posted" */
export function useAnnounce() {
    return useContext(AnnouncerContext);
}

/**
 * One visually hidden, polite live region for the whole toolbar. The region is always rendered
 * (live regions only announce changes), and is cleared first so the same message is announced
 * again when it repeats.
 */
export function AnnouncerProvider({ children }: PropsWithChildren) {
    const [message, setMessage] = useState('');
    const timeoutRef = useRef<number>(undefined);

    const announce = useCallback((next: string) => {
        window.clearTimeout(timeoutRef.current);
        setMessage('');
        timeoutRef.current = window.setTimeout(() => setMessage(next), 100);
    }, []);

    useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

    return (
        <AnnouncerContext.Provider value={announce}>
            {children}
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {message}
            </div>
        </AnnouncerContext.Provider>
    );
}
