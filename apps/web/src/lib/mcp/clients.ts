/** Each configuration contains references only, never a supplied credential. */
export function mcpClientConfigurations(endpoint: string) {
    const remote = (authorization: string) => ({ url: endpoint, headers: { Authorization: authorization } });
    return [
        { id: 'codex', name: 'Codex', location: '~/.codex/config.toml', docs: 'https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers',
            configuration: `[mcp_servers.uier]\nurl = "${endpoint}"\nbearer_token_env_var = "UIER_MCP_TOKEN"` },
        { id: 'claude-code', name: 'Claude Code', location: '.mcp.json', docs: 'https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson',
            configuration: JSON.stringify({ mcpServers: { uier: { type: 'http', ...remote('Bearer ${UIER_MCP_TOKEN}') } } }, null, 2) },
        { id: 'cursor', name: 'Cursor', location: '.cursor/mcp.json', docs: 'https://cursor.com/docs/mcp#config-interpolation',
            configuration: JSON.stringify({ mcpServers: { uier: remote('Bearer ${env:UIER_MCP_TOKEN}') } }, null, 2) },
        { id: 'vscode', name: 'VS Code', location: '.vscode/mcp.json', docs: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
            configuration: JSON.stringify({ inputs: [{ type: 'promptString', id: 'uier-mcp-token', description: 'uier MCP credential', password: true }], servers: { uier: { type: 'http', ...remote('Bearer ${input:uier-mcp-token}') } } }, null, 2) },
    ];
}
