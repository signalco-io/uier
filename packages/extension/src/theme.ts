/**
 * Extension pages follow the system theme, like the toolbar's threads (BRAND.md, "The review layer").
 * The UI kit's `dark:` variants match `[class="dark"]`, so the class is exactly `dark` or empty.
 * Applied before the first render so a dark browser never flashes a paper popup.
 */
export function followSystemTheme() {
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', scheme.matches);
    apply();
    scheme.addEventListener('change', apply);
    return () => scheme.removeEventListener('change', apply);
}
