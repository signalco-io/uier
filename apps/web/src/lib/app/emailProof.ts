// An email address that a sign-in proved its person controls now. Safe for the browser: no server imports.
//
// A uier account email is proven once, when the account is created, and stays the account's email. The person
// may lose that inbox later (they leave the company, their Google Workspace address is renamed) and still sign
// in with a passkey, a linked Google or Microsoft account or an old session. Steps that trust the email's
// domain (joining a workspace through it, adding it to a workspace) need a fresh proof instead:
//
// - an email code or link sent to the address, or an invitation link (`startSession` with the address);
// - Google returning the address as verified for a Workspace domain it names (`googleIsAuthoritative`).
//
// Passkeys and linked Microsoft identities prove no email. The proof is kept in the session token as a keyed
// hash of the address (`sessionIdentity.ts`) and counts for `EMAIL_PROOF_SECONDS` after the sign-in.

/** What a sign-in proved: the account email and when (ms) */
export type EmailProof = { email: string; provenAt: number };

/** How long a sign-in's email proof counts for joining or adding an email domain */
export const EMAIL_PROOF_SECONDS = 10 * 60;

/** Joining through an email domain without a fresh proof; the join page recognizes it and offers a new sign-in */
export const DOMAIN_JOIN_SIGN_IN_AGAIN = 'To join, sign in again with your email. Joining needs a sign-in from the last 10 minutes that confirms your email address.';

/** Adding an email domain without a fresh proof; the domain settings recognize it and offer a new sign-in */
export const DOMAIN_ADD_SIGN_IN_AGAIN = 'To add a domain, sign in again with your email. Adding one needs a sign-in from the last 10 minutes that confirms your email address.';

/** `email` when `proof` proved it within the last `EMAIL_PROOF_SECONDS`, otherwise `null` */
export function freshlyProvenEmail(email: string, proof: EmailProof | null | undefined, now = Date.now()) {
    return proof && proof.email === email && proof.provenAt <= now && now - proof.provenAt <= EMAIL_PROOF_SECONDS * 1000 ? email : null;
}
