import { Project } from '@pulumiverse/vercel';

// Inlined from signalco infra/packages/pulumi/src/vercel (vercelApp.ts + nextJsApp.ts).
// The logical resource name (`vercel-${prefix}`) must stay stable - it identifies the existing
// Vercel project (prj_0uRTXTGHFdN9SlHnFfNiahIgX3mc) in Pulumi state. The project name itself can
// change in place (it was "signalco-uier" before the split).

export function vercelApp(prefix: string, name: string, {
    framework,
    ignoreCommand,
    outputDirectory,
    rootDirectory,
    nodeVersion,
    protect = false,
}: {
    framework?: 'nextjs';
    ignoreCommand?: string;
    outputDirectory?: string;
    rootDirectory?: string;
    nodeVersion?: '22.x' | '24.x';
    protect?: boolean;
}) {
    const project = new Project(`vercel-${prefix}`, {
        framework,
        ignoreCommand,
        outputDirectory,
        name,
        // Replaces the deprecated `serverlessFunctionRegion: 'dub1'`; the provider sends
        // both as resourceConfig.functionDefaultRegions = ['dub1'] (in-place update).
        resourceConfig: {
            functionDefaultRegions: ['dub1'],
        },
        rootDirectory,
        nodeVersion,
    }, { protect });

    return {
        projectId: project.id,
    };
}

export function nextJsApp(prefix: string, name: string, rootDirectory?: string, protect = false) {
    return vercelApp(prefix, name, {
        framework: 'nextjs',
        rootDirectory,
        nodeVersion: '24.x',
        protect,
    });
}
