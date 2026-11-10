import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { resolveToolbarFeatures, toolbarFeatures } from '@uier/toolbar/toolbar-features';
import { toolbarFeatureVisibilitySchema } from '../src/lib/app/toolbarFeatures';
import { getProject, updateProject } from '../src/lib/app/projects';
import type { DbProject } from '../src/lib/app/model';
import { reviewProjectDto } from '../src/lib/review/routes';
import { persistProjectAccess } from './support/projectAccess';

test('missing lists include every tool, explicit lists stay fixed and signed-out lists only narrow project tools', () => {
    for (const member of [true, false]) {
        expect(resolveToolbarFeatures(undefined, member)).toEqual(toolbarFeatures);
        expect(resolveToolbarFeatures({}, member)).toEqual(toolbarFeatures);
        // No implicit additions, even when the current list has more features.
        expect(resolveToolbarFeatures({ enabled: ['seo'] }, member)).toEqual(['seo']);
        expect(resolveToolbarFeatures({ enabled: [] }, member)).toEqual([]);
    }
    const visibility = { enabled: ['accessibility', 'seo'] as const, signedOut: ['seo', 'rewrite'] as const };
    expect(resolveToolbarFeatures({ enabled: [...visibility.enabled], signedOut: [...visibility.signedOut] }, true)).toEqual(['accessibility', 'seo']);
    expect(resolveToolbarFeatures({ enabled: [...visibility.enabled], signedOut: [...visibility.signedOut] }, false)).toEqual(['seo']);
    expect(resolveToolbarFeatures({ signedOut: [] }, true)).toEqual(toolbarFeatures);
    expect(resolveToolbarFeatures({ signedOut: [] }, false)).toEqual([]);
});

test('feature settings validate before persistence and preserve unrelated project settings', async () => {
    const previousLocal = process.env.UIER_LOCAL;
    process.env.UIER_LOCAL = '1';
    try {
        const project = await persistProjectAccess({ id: randomUUID().replaceAll('-', '').slice(0, 12), brief: 'Keep this brief' } as DbProject);
        for (const invalid of [{ enabled: ['unknown'] }, { enabled: ['seo', 'seo'] }, { enabled: 'seo' }, { signedOut: null }, { arbitrary: [] }]) {
            expect(toolbarFeatureVisibilitySchema.safeParse(invalid).success).toBe(false);
            await expect(updateProject(project.workspaceId, project.id, { toolbarFeatures: invalid as never, brief: 'Changed' })).rejects.toThrow();
            expect((await getProject(project.workspaceId, project.id))!.brief).toBe('Keep this brief');
        }
        await updateProject(project.workspaceId, project.id, { toolbarFeatures: { enabled: ['seo'], signedOut: [] } });
        const saved = (await getProject(project.workspaceId, project.id))!;
        expect(saved).toMatchObject({ access: 'guests', brief: 'Keep this brief', toolbarFeatures: { enabled: ['seo'], signedOut: [] } });
        const publicProject = { ...saved, publicId: 'toolbarfeatures1234567' };
        expect(reviewProjectDto(publicProject, true, [], true).toolbarFeatures).toEqual(['seo']);
        const guest = reviewProjectDto(publicProject, true);
        expect(guest.toolbarFeatures).toEqual([]);
        expect(guest.feedbackTypes).not.toHaveLength(0);
        expect(reviewProjectDto(publicProject, false)).not.toHaveProperty('toolbarFeatures');
        // Only the effective array crosses the bootstrap boundary, never the other audience's settings.
        expect(JSON.stringify(guest)).not.toContain('signedOut');
        await updateProject(project.workspaceId, project.id, { toolbarFeatures: undefined });
        expect(resolveToolbarFeatures((await getProject(project.workspaceId, project.id))!.toolbarFeatures, false)).toEqual(toolbarFeatures);
    } finally {
        if (previousLocal === undefined) delete process.env.UIER_LOCAL;
        else process.env.UIER_LOCAL = previousLocal;
    }
});
