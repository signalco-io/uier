import { Button } from '@uier/ui-primitives/Button';
import { brand } from '@uier/brand';
import { InlineLink, PageSection, Panel, Tile } from '@/src/components/marketing/ContentPage';
import { AgentSpecimen } from '@/src/components/marketing/AiSpecimens';
import { CodeWindow, GuideHeader, GuidePicture, GuideStep, GuideSteps, StepText } from '@/src/components/marketing/guides/GuideLayout';
import { KnownPageLinks, KnownPages } from '@/src/knownPages';
import { mcpGuide } from '@/src/lib/guides/mcp';
import { publicPageMetadata } from '@/src/lib/metadata';
import { mcpClientConfigurations, mcpPluginCommands } from '@/src/lib/mcp/clients';

// Setup follows docs/mcp.md, docs/agent-plugins.md and Account's shared client configurations.
// Client support is a uier qualification claim, separate from what a vendor's protocol supports.
export const metadata = publicPageMetadata(mcpGuide.path, mcpGuide);
const endpoint = `${brand.url}/api/mcp`;
const account = `${KnownPageLinks.account('coding-agents')}#connect`;
const reference = `${brand.repository}/blob/main/docs/mcp.md`;
const sections = {
    choose: { id: 'choose-your-connection', title: 'Choose your connection', number: 1 },
    connect: { id: 'connect-your-client', title: 'Connect your client', number: 2 },
    read: { id: 'read-one-thread', title: 'Read one thread', number: 3 },
    permissions: { id: 'permissions', title: 'Choose what it can reach' },
    cards: { id: 'thread-cards', title: 'Display a thread card' },
    troubleshoot: { id: 'troubleshooting', title: 'If the connection fails' },
    revoke: { id: 'revoke-access', title: 'Revoke access' }
};

export default function McpSetupGuide() {
    return <main className="flex flex-col pb-16">
        <GuideHeader title={mcpGuide.title} lead={mcpGuide.description} outline={Object.values(sections)}>
            <Button variant="solid" size="lg" href={account}>Open coding agent settings</Button>
        </GuideHeader>
        <GuideSteps>
            <GuideStep {...sections.choose} lead="Use one connection for each client."
                aside={<GuidePicture className="rounded-2xl border"><AgentSpecimen /></GuidePicture>}>
                <StepText>A standalone MCP connection reads feedback without installing a plugin. The optional uier plugin adds that connection and the monitor skills for Claude Code or Codex.</StepText>
                <StepText muted>Installing a plugin starts no monitor and changes no feedback. Invoking the monitor authorizes its documented workflow, including fixes, replies and merges for comments in scope. Read the <InlineLink href={`${brand.repository}/blob/main/docs/uier-monitor.md`}>monitor guide</InlineLink> before starting it.</StepText>
            </GuideStep>
            <GuideStep {...sections.connect} lead={<>The Streamable HTTP endpoint is <code className="break-all font-mono text-sm">{endpoint}</code>.</>}>
                {mcpClientConfigurations(endpoint).map(client => <div key={client.id} className="flex min-w-0 flex-col gap-4">
                    <h3 className="text-xl font-semibold">{client.name}</h3>
                    {client.auth === 'oauth' ? <>
                        <StepText>Add the server, then run /mcp in Claude Code, choose uier and select Authenticate. Sign in to uier and approve the accounts, projects and operations you need.</StepText>
                        <CodeWindow file="Terminal" label={`${client.name} connection command`} code={client.command} />
                    </> : <>
                        <StepText>In Account → Coding agents → Access tokens, name a token and choose its projects and operations. Set UIER_MCP_TOKEN in the environment that starts {client.name}, then merge this entry into your configuration.</StepText>
                        <CodeWindow file={client.location} label={`${client.name} MCP configuration`} code={client.configuration} />
                    </>}
                    <InlineLink href={client.docs}>{client.name} configuration reference</InlineLink>
                </div>)}
                <StepText muted>These are the client paths offered by uier today: Claude Code uses browser sign-in; Codex and Cursor use access tokens. A client supporting OAuth does not mean its complete uier sign-in, refresh and revocation flow has been qualified.</StepText>
                <details className="rounded-xl border p-5">
                    <summary className="cursor-pointer font-medium">Install the optional plugin instead</summary>
                    <div className="flex min-w-0 flex-col gap-5 pt-5">
                        <CodeWindow file="Claude Code session" label="Claude Code plugin commands" code={mcpPluginCommands.claudeCode} />
                        <StepText>Run /mcp and authenticate the plugin’s uier connection. Disable a duplicate standalone connection.</StepText>
                        <CodeWindow file="Terminal" label="Codex plugin commands" code={mcpPluginCommands.codex} />
                        <StepText>Start a new session and follow the plugin sign-in flow. If it cannot finish, keep the offered access-token connection above and use the skills with it.</StepText>
                        <StepText muted>Repository installation and public directory approval are separate. The <InlineLink href={`${brand.repository}/blob/main/docs/agent-plugins.md`}>plugin reference</InlineLink> covers updates and the installed code’s data access.</StepText>
                    </div>
                </details>
            </GuideStep>
            <GuideStep {...sections.read} lead="Start with a read that changes nothing.">
                <StepText>Ask the coding tool to list the projects this connection can access. Choose the intended project, list its feedback and read one thread. Use the returned project and comment identifiers rather than guessing them.</StepText>
                <CodeWindow file="Ask your coding tool" label="First authorized read" code={'Use uier to list my accessible projects.\nLet me choose a project, then list its feedback.\nRead the thread I choose and cite its uier link.\nDo not reply, assign or change its status.'} />
                <StepText muted>MCP gives your tool context. It does not edit your repository or automatically fix a bug. Your coding tool performs code work; approve each write to uier there. Other feedback tools also offer MCP.</StepText>
            </GuideStep>
        </GuideSteps>
        <PageSection {...sections.permissions} lead="A connection never exceeds the selected person’s current access.">
            <Panel className="md:grid-cols-2">
                <Tile title="Projects and membership"><p>OAuth consent can select several signed-in accounts and their workspaces/projects. Each call uses one authorized profile. Access tokens select up to 20 projects in one workspace and do not expand to new projects.</p></Tile>
                <Tile title="Operations"><p>Read feedback is the starting permission. Read screenshots, reply, change status, assign and create tokens each require their own permission. Current membership and private-thread visibility are checked on every read and write.</p></Tile>
                <Tile title="Images and private context"><p>Original and reply-image resources need Read screenshots plus access to that thread. Request images only when needed. A project code, guest identity, review link or app cookie is not an MCP credential.</p></Tile>
                <Tile title="Secrets and copies"><p>Account tokens are shown once and expire after 30 days. Keep the secret outside configuration files, repositories and chat. Data already read by a client follows that client’s retention rules.</p></Tile>
            </Panel>
            <InlineLink href={KnownPages.Security}>Security and permission details</InlineLink>
        </PageSection>
        <PageSection {...sections.cards} lead="Ask the tool to show one selected feedback thread.">
            <StepText>show_feedback returns the authorized thread packet. Hosts with MCP Apps support can display a read-only card with its status, assignee, latest message and Open in uier link. Other clients receive the packet and Markdown.</StepText>
            <StepText muted>A connected visible card checks every 30 seconds and offers Refresh. It rechecks access; a denied read clears the content. Rendering depends on the host, and an old card may stop updating when its connection ends. Refreshing does not approve writes or start monitoring.</StepText>
        </PageSection>
        <PageSection {...sections.troubleshoot} lead="Check the credential and its access before granting more.">
            <Panel>
                <Tile title="Claude Code never opens sign-in"><p>Remove an existing Authorization header from the uier entry, or remove the server with claude mcp remove uier and add it again. A configured header prevents Claude Code from trying OAuth.</p></Tile>
                <Tile title="Unauthorized or expired token"><p>Check that UIER_MCP_TOKEN exists in the environment that starts the client. Reconnect after changing it. Account tokens expire or can be revoked; create a replacement in Account rather than putting the secret in a JSON or TOML file.</p></Tile>
                <Tile title="Missing project, thread or operation"><p>Check selected projects, current membership, private-thread visibility and the required operation. A missing thread can mean lost access. Request only the permission the intended action needs.</p></Tile>
                <Tile title="No card or stale tool list"><p>The host may not support MCP Apps. Use the Markdown result, or reconnect/start a new client session after an update. A hosted connector’s directory listing and OAuth qualification are separate from a local client connection.</p></Tile>
            </Panel>
        </PageSection>
        <PageSection {...sections.revoke} lead="End access from Account → Coding agents.">
            <StepText>Revoke an OAuth connection under Connected apps, or revoke its access token under Access tokens. Revocation blocks subsequent calls; it cannot erase copies already held by a coding tool. A project transfer, removed membership or lost team grant can also end access.</StepText>
            <StepText muted>Use <InlineLink href={reference}>the full MCP reference</InlineLink> for tools, limits, events and qualification receipts. See the <InlineLink href={KnownPages.LegalPrivacyPolicy}>privacy policy</InlineLink> before sharing feedback with another service.</StepText>
            <InlineLink href={KnownPages.Ai}>What a coding agent can do with feedback</InlineLink>
        </PageSection>
    </main>;
}
