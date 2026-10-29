import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { mcpProject, type McpIdentity } from './credentials';
import { ApiError } from '../comments/http';
import { projectId, thread } from './schemas';
import { feedbackWorkflows } from './workflows';

export function registerFeedbackPrompts(server: McpServer, identity: McpIdentity) {
    for (const workflow of feedbackWorkflows(identity.scopes)) {
        server.registerPrompt(workflow.name, {
            title: workflow.title,
            description: workflow.description,
            argsSchema: workflow.thread ? thread : { projectId },
        }, async (input: { projectId: string; commentId?: string }): Promise<GetPromptResult> => {
            // No feedback is read or embedded here. Tools recheck thread visibility on every read.
            // Load the project even for a valid-looking id: a grant is not current membership.
            try { await mcpProject(identity, input.projectId); }
            catch (error) {
                if (error instanceof ApiError) throw new McpError(ErrorCode.InvalidParams, `${error.code}: ${error.message}`);
                throw new McpError(ErrorCode.InternalError, 'The operation failed.');
            }
            return { messages: [{ role: 'user', content: { type: 'text', text: `${workflow.instructions}

Selected projectId: ${input.projectId}${'commentId' in input ? `
Selected commentId: ${input.commentId}` : ''}` } }] };
        });
    }
}
