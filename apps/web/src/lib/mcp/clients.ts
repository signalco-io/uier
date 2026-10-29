/**
 * Account's client setups, built from one endpoint. `oauth` clients sign in with a browser and need no
 * secret; `token` clients read an access token from `UIER_MCP_TOKEN`. Each configuration contains
 * references only, never a supplied credential. Offer a client only after checking its connection.
 */
export type McpClientSetup =
    | { id: string; name: string; docs: string; auth: 'oauth'; command: string }
    | { id: string; name: string; docs: string; auth: 'token'; location: string; configuration: string };

export function mcpClientConfigurations(endpoint: string): McpClientSetup[] {
    const remote = (authorization: string) => ({ url: endpoint, headers: { Authorization: authorization } });
    return [
        { id: 'claude-code', name: 'Claude Code', auth: 'oauth', docs: 'https://code.claude.com/docs/en/mcp#authenticate-with-remote-mcp-servers',
            command: `claude mcp add --transport http uier ${endpoint}` },
        { id: 'codex', name: 'Codex', auth: 'token', location: '~/.codex/config.toml', docs: 'https://learn.chatgpt.com/docs/extend/mcp#streamable-http-servers',
            configuration: `[mcp_servers.uier]\nurl = "${endpoint}"\nbearer_token_env_var = "UIER_MCP_TOKEN"` },
        { id: 'cursor', name: 'Cursor', auth: 'token', location: '.cursor/mcp.json', docs: 'https://cursor.com/docs/mcp#config-interpolation',
            configuration: JSON.stringify({ mcpServers: { uier: remote('Bearer ${env:UIER_MCP_TOKEN}') } }, null, 2) }
    ];
}
