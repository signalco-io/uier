export const tokenScopes = ['feedback:read', 'screenshots:read', 'feedback:reply', 'feedback:status', 'feedback:assign'] as const;
export const mcpScopes = [...tokenScopes, 'tokens:create'] as const;
export type McpScope = typeof mcpScopes[number];
