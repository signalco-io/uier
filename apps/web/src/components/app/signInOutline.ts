/**
 * The sign-in card's outline (`AuthCardOutline`): its two lines of explanation and its four ways to sign in (a passkey,
 * Google, Microsoft and the email), so the outline is as tall as the form a deployment with every option shows. Not in
 * `AuthFrame`'s client module: the layout and the page that pass it on are server components.
 */
export const signInOutline = { actions: 4, description: 2 } as const;
