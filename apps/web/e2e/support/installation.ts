import { expect, type Locator } from '@playwright/test';

/** Allow the app's 30 s diagnostic handshake to finish, then require a successful result. */
export async function expectInstallationSuccess(check: Locator) {
    const result = check.getByRole('status', { name: 'Installation result' });
    // Popup creation precedes navigation, session exchange, API reads and browser verification.
    // Stop waiting on any terminal result so failures retain their diagnostic rather than timing out.
    await expect(result).toHaveAttribute('data-result', /^(success|failure|inconclusive)$/, { timeout: 35_000 });
    await expect(result).toHaveAttribute('data-result', 'success', { timeout: 0 });
}
