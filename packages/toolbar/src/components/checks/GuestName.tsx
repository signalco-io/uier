import { createContext, useCallback, useContext, useRef, useState, type Dispatch, type PropsWithChildren, type SetStateAction } from 'react';
import { Input } from '@signalco/ui-primitives/Input';
import { cx } from '@signalco/ui-primitives/cx';
import { useProjectViewer } from '../../project/ProjectGate';
import { getGuestName, setGuestName } from '../../project/projectSession';
import { destructiveTextClassName, inputFocusRingClassName } from '../@types/Comments';
import { useMessages } from '../../i18n';

/** Longest guest name the review API accepts (as in the comment form) */
const guestNameMaxLength = 80;

/** The panel a name field is in (both checks panels can be open together, each with its own field) */
type GuestNamePanel = 'accessibility' | 'seo' | 'consent';

type GuestNameState = {
    needed: boolean;
    name: string;
    setName: (name: string) => void;
    /** The panel whose quick action asked for the name: only its field says so */
    missing: GuestNamePanel | undefined;
    setMissing: Dispatch<SetStateAction<GuestNamePanel | undefined>>;
    save: (name: string) => void;
    /** Each open panel's field, by panel (a field leaves when its panel closes) */
    fields: Map<GuestNamePanel, HTMLDivElement>;
};

const GuestNameContext = createContext<GuestNameState | null>(null);

/**
 * A project's guests tag their comments with their name, asked once and kept on this site, as in
 * the comment form: the panels ask for it above their issues until it is known. One name for both
 * panels; each open panel has its own field, and a quick action asks in the panel it was pressed in.
 */
export function GuestNameProvider({ children }: PropsWithChildren) {
    const { needsName } = useProjectViewer();
    const [saved, setSaved] = useState(() => getGuestName());
    const [name, setName] = useState('');
    const [missing, setMissing] = useState<GuestNamePanel>();
    const fields = useRef(new Map<GuestNamePanel, HTMLDivElement>()).current;
    const save = (value: string) => {
        setGuestName(value);
        setSaved(value.trim());
    };
    return (
        // A name given in a comment form meanwhile counts too
        <GuestNameContext value={{ needed: needsName && !(saved || getGuestName()), name, setName, missing, setMissing, save, fields }}>
            {children}
        </GuestNameContext>
    );
}

/** Before a quick action in `panel` posts: true once the reviewer has a name (or needs none), else that panel's field asks */
export function useGuestNameGate() {
    const state = useContext(GuestNameContext);
    return (panel: GuestNamePanel) => {
        if (!state?.needed) return true;
        // Given in a comment form meanwhile
        const stored = getGuestName();
        if (stored) {
            state.save(stored);
            return true;
        }
        if (!state.name.trim()) {
            state.setMissing(panel);
            state.fields.get(panel)?.querySelector('input')?.focus();
            return false;
        }
        state.save(state.name);
        return true;
    };
}

/** The name field, above `panel`'s issues while the name is not known */
export function GuestNameField({ panel }: { panel: GuestNamePanel }) {
    const state = useContext(GuestNameContext);
    const t = useMessages();
    const fields = state?.fields;
    const setMissing = state?.setMissing;
    const register = useCallback((element: HTMLDivElement | null) => {
        if (!fields || !element) return;
        fields.set(panel, element);
        return () => {
            if (fields.get(panel) !== element) return;
            fields.delete(panel);
            // Closed while asking: it does not ask again when it opens
            setMissing?.(current => current === panel ? undefined : current);
        };
    }, [fields, setMissing, panel]);
    if (!state?.needed) return null;
    return (
        <div ref={register} className="flex flex-col gap-1">
            <Input
                label={t.composer.yourName}
                name="authorName"
                value={state.name}
                onChange={event => {
                    state.setName(event.target.value);
                    state.setMissing(undefined);
                }}
                maxLength={guestNameMaxLength}
                autoComplete="name"
                placeholder={t.composer.namePlaceholder}
                className={inputFocusRingClassName}
                fullWidth />
            {state.missing === panel && <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName)}>{t.composer.enterName}</p>}
        </div>
    );
}
