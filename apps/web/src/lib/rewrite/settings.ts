import { z } from 'zod';
import { projectSettingModeSchema, projectSettingSchema, resolveProjectSetting, type ProjectSetting } from '../app/inheritedSettings';
import type { DbProject, DbWorkspace } from '../app/model';

/** Per workspace or project. Append can send at most twice this plus a blank line. */
export const MAX_REWRITE_INSTRUCTIONS_LENGTH = 2000;
export const rewriteInstructionsSchema = z.string()
    .max(MAX_REWRITE_INSTRUCTIONS_LENGTH, `Use at most ${MAX_REWRITE_INSTRUCTIONS_LENGTH} characters for rewrite instructions.`)
    .trim();
export const projectRewriteInstructionsSchema = projectSettingSchema(rewriteInstructionsSchema);
export const rewriteInstructionsFormSchema = z.object({ mode: projectSettingModeSchema, value: rewriteInstructionsSchema });

/** The form's workspace mode removes the project setting; an empty replacement stays explicit. */
export function projectRewriteInstructionsInput(input: unknown): ProjectSetting<string> | undefined {
    const { mode, value } = rewriteInstructionsFormSchema.parse(input);
    return mode === 'workspace' ? undefined : { mode, value };
}

/** Validate stored values too: malformed legacy data is ignored, never sent to the provider. */
export function workspaceRewriteInstructions(workspace: Pick<DbWorkspace, 'rewriteInstructions'> | null | undefined): string {
    const parsed = rewriteInstructionsSchema.safeParse(workspace?.rewriteInstructions ?? '');
    return parsed.success ? parsed.data : '';
}

export function projectRewriteInstructions(project: Pick<DbProject, 'rewriteInstructions'>): ProjectSetting<string> | undefined {
    const parsed = projectRewriteInstructionsSchema.safeParse(project.rewriteInstructions);
    return parsed.success ? parsed.data : undefined;
}

export function effectiveRewriteInstructions(workspace: Pick<DbWorkspace, 'rewriteInstructions'> | null | undefined, project: Pick<DbProject, 'rewriteInstructions'>): string {
    return resolveProjectSetting(workspaceRewriteInstructions(workspace), projectRewriteInstructions(project),
        (base, extra) => [base, extra].filter(Boolean).join('\n\n'));
}
