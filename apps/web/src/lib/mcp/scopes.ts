export const mcpScopes = ['feedback:read', 'screenshots:read', 'feedback:reply', 'feedback:status', 'feedback:assign'] as const;
export type McpScope = typeof mcpScopes[number];
