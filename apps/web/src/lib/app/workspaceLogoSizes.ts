/** The 32 px workspace switcher mark and its 2× image. */
export const workspaceLogoSizes = [32, 64] as const;
export type WorkspaceLogoSize = typeof workspaceLogoSizes[number];

export const MAX_WORKSPACE_LOGO_DIMENSION = 4096;
