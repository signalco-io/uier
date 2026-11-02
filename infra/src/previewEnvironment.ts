import { runtime } from '@pulumi/pulumi';

type ExistingVariable = { name: string; key: string; sensitive: boolean };

export function parsePreviewEnvironment(encoded: string | undefined, dryRun: boolean): Map<string, ExistingVariable> {
    if (!encoded) return new Map();
    if (!dryRun) throw new Error('A preview environment snapshot cannot be used for an update.');
    let values: unknown;
    try { values = JSON.parse(encoded); } catch { throw new Error('Invalid preview environment metadata.'); }
    if (!Array.isArray(values) || values.length > 128) throw new Error('Invalid preview environment metadata.');
    const result = new Map<string, ExistingVariable>();
    for (const value of values) {
        if (!value || typeof value !== 'object' || Object.keys(value).sort().join() !== 'key,name,sensitive'
            || typeof value.key !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(value.key)
            || typeof value.name !== 'string' || !/^vercel-uier-[a-z0-9-]+$/.test(value.name)
            || typeof value.sensitive !== 'boolean' || result.has(value.key))
            throw new Error('Invalid preview environment metadata.');
        result.set(value.key, value);
    }
    return result;
}

export function previewEnvironment() {
    return parsePreviewEnvironment(process.env.UIER_PREVIEW_ENV_METADATA, runtime.isDryRun());
}

/** Existing inputs come from the engine's state via ignoreChanges; the placeholder is preview-only. */
export function preservePreviewValue(existing: Map<string, ExistingVariable>, key: string, name: string) {
    const variable = existing.get(key);
    if (variable && variable.name !== name) throw new Error('Preview variable identity does not match state.');
    return variable ? { ignoreChanges: ['value'] } : {};
}
