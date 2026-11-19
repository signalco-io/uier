export const tokenScopes = ['feedback:read', 'screenshots:read', 'feedback:reply', 'feedback:status', 'feedback:assign', 'proofs:read', 'proofs:upload'] as const;
export const mcpScopes = [...tokenScopes, 'tokens:create'] as const;
export type McpScope = typeof mcpScopes[number];

export const hasMcpReadScope = (scopes: readonly McpScope[]) => scopes.includes('feedback:read') || scopes.includes('proofs:read');
export const restScopes = ['feedback:read', 'feedback:reply', 'feedback:status'] as const satisfies readonly McpScope[];
