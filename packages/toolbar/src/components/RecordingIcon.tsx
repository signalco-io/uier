/** Lucide's video icon, drawn like the UI kit's icons (the kit has no video icon). */
export function RecordingIcon({ size = 16 }: { size?: number }) {
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m16 13 5.223 3.482A.5.5 0 0 0 22 16.066V7.934a.5.5 0 0 0-.777-.416L16 11" />
        <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>;
}
