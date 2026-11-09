import { vercelTeamId } from './vercelScope.js';
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
    nodeVersion?: '22.x' | '24.x' | '26.x';
    protect?: boolean;
}) {
    const project = new Project(`vercel-${prefix}`, {
        teamId: vercelTeamId,
        framework,
        ignoreCommand,
        outputDirectory,
        name,
        // Replaces the deprecated `serverlessFunctionRegion: 'dub1'`; the provider sends
        // both as resourceConfig.functionDefaultRegions = ['dub1'] (in-place update).
        resourceConfig: {
            functionDefaultRegions: ['dub1'],
            // Vercel Functions WebSockets (`/api/realtime`) require Fluid compute. It is set on the
            // project, not in vercel.json: CI deploys prebuilt output without a checkout, so the
            // deploy step never reads vercel.json and deployments would use the project default.
            fluid: true,
            // Fluid compute rejects the project's former 'standard_legacy' (0.6 vCPU) size; 'standard'
            // (1 vCPU) is the smallest it accepts. Sent with `fluid` in the same project update.
            functionDefaultCpuType: 'standard',
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
        nodeVersion: '26.x',
        protect,
    });
}
