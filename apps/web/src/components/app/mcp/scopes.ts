import type { McpScope } from '@/src/lib/mcp/scopes';

/** What each MCP scope lets a coding tool do, in the words Account and consent both use */
export const scopeOptions: readonly { scope: McpScope; label: string; description: string; write: boolean }[] = [
    { scope: 'feedback:read', label: 'Read feedback', description: 'List and read feedback threads. Reading does not mark them read.', write: false },
    { scope: 'screenshots:read', label: 'Read screenshots', description: 'Open the screenshots attached to feedback.', write: false },
    { scope: 'feedback:reply', label: 'Reply to feedback', description: 'Post replies as you, labeled with the connection name.', write: true },
    { scope: 'feedback:status', label: 'Change status', description: 'Mark feedback in progress or done, or open it again.', write: true },
    { scope: 'feedback:assign', label: 'Assign feedback', description: 'Assign feedback to people who can see it, manage thread labels, link pull requests, and show the coding tool as your agent.', write: true },
    { scope: 'tokens:create', label: 'Create access tokens', description: 'Create named tokens for scripts and watchers, for up to 30 days, within this connection’s projects and operations. The coding tool receives each secret once. Created tokens are separate and listed under Access tokens.', write: true }
];

export function scopeLabel(scope: string) {
    return scopeOptions.find(option => option.scope === scope)?.label ?? scope;
}
