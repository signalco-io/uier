// Private reference frames must stay out of recordings of the reviewed site.
const listeners = new Set<() => void>();
let active = 0;

export const privatePreviewHidden = () => active > 0;
export const subscribeToCapturePrivacy = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export function hidePrivatePreviews() {
    active++;
    for (const listener of listeners) listener();
    return () => {
        active--;
        for (const listener of listeners) listener();
    };
}
