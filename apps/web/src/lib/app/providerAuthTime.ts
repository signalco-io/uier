/**
 * A sign-in provider's `auth_time` claim (Unix seconds): when the person last authenticated there. A provider
 * continues the session a browser has with it, so this, not the sign-in itself, shows whether the person was
 * just asked (`sessionSignedInAt`). `undefined` when the token has none or one that cannot be: `latest` allows
 * for the provider's clock running ahead of ours.
 */
export function providerAuthTime(value: unknown, latest: number) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= latest ? Math.floor(value) : undefined;
}
