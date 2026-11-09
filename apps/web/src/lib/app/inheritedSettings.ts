import { z } from 'zod';

/** Missing project settings inherit. An explicit replacement may deliberately be empty. */
export type ProjectSetting<T> = { mode: 'append' | 'replace'; value: T };
export const projectSettingModes = ['workspace', 'append', 'replace'] as const;
export const projectSettingModeSchema = z.enum(projectSettingModes);
export type ProjectSettingMode = typeof projectSettingModes[number];

/** Each setting owns validation, its empty default and how values are combined. */
export function projectSettingSchema<T extends z.ZodType>(value: T) {
    return z.object({ mode: z.enum(['append', 'replace']), value }).strict();
}

export function resolveProjectSetting<T>(workspace: T, project: ProjectSetting<T> | undefined, append: (workspace: T, project: T) => T): T {
    if (!project) return workspace;
    return project.mode === 'replace' ? project.value : append(workspace, project.value);
}
