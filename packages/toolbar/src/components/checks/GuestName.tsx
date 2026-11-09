import { createContext, useContext, useRef, useState, type PropsWithChildren, type RefObject } from 'react';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { useProjectViewer } from '../../project/ProjectGate';
import { getGuestName, setGuestName } from '../../project/projectSession';
import { destructiveTextClassName, inputFocusRingClassName } from '../@types/Comments';

/** Longest guest name the review API accepts (as in the comment form) */
const guestNameMaxLength = 80;

type GuestNameState = {
    needed: boolean;
    name: string;
    setName: (name: string) => void;
    missing: boolean;
    setMissing: (missing: boolean) => void;
    save: (name: string) => void;
    fieldRef: RefObject<HTMLDivElement | null>;
};

const GuestNameContext = createContext<GuestNameState | null>(null);

/**
 * A project's guests tag their comments with their name, asked once and kept on this site, as in
 * the comment form: the panels ask for it above their issues until it is known.
 */
export function GuestNameProvider({ children }: PropsWithChildren) {
    const { needsName } = useProjectViewer();
    const [saved, setSaved] = useState(() => getGuestName());
    const [name, setName] = useState('');
    const [missing, setMissing] = useState(false);
    const fieldRef = useRef<HTMLDivElement>(null);
    const save = (value: string) => {
        setGuestName(value);
        setSaved(value.trim());
    };
    return (
        // A name given in a comment form meanwhile counts too
        <GuestNameContext value={{ needed: needsName && !(saved || getGuestName()), name, setName, missing, setMissing, save, fieldRef }}>
            {children}
        </GuestNameContext>
    );
}

/** Before a quick action posts: true once the reviewer has a name (or needs none), else the field asks */
export function useGuestNameGate() {
    const state = useContext(GuestNameContext);
    return () => {
        if (!state?.needed) return true;
        // Given in a comment form meanwhile
        const stored = getGuestName();
        if (stored) {
            state.save(stored);
            return true;
        }
        if (!state.name.trim()) {
            state.setMissing(true);
            state.fieldRef.current?.querySelector('input')?.focus();
            return false;
        }
        state.save(state.name);
        return true;
    };
}

/** The name field, above a panel's issues while the name is not known */
export function GuestNameField() {
    const state = useContext(GuestNameContext);
    if (!state?.needed) return null;
    return (
        <div ref={state.fieldRef} className="flex flex-col gap-1">
            <Input
                label="Your name"
                name="authorName"
                value={state.name}
                onChange={event => {
                    state.setName(event.target.value);
                    state.setMissing(false);
                }}
                maxLength={guestNameMaxLength}
                autoComplete="name"
                placeholder="Shown with your comments"
                className={inputFocusRingClassName}
                fullWidth />
            {state.missing && <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName)}>Enter your name to comment.</p>}
        </div>
    );
}
