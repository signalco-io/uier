import { ProtocolError, ProtocolErrorCode, type GetPromptResult, type McpServer } from '@modelcontextprotocol/server';
import { mcpProject, type McpIdentity } from './credentials';
import { ApiError } from '../comments/http';
import { projectId, thread } from './schemas';
import { feedbackWorkflows } from './workflows';
import { noteMcpError } from './telemetry';

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
                noteMcpError(error);
                if (error instanceof ApiError) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `${error.code}: ${error.message}`);
                throw new ProtocolError(ProtocolErrorCode.InternalError, 'The operation failed.');
            }
            return { messages: [{ role: 'user', content: { type: 'text', text: `${workflow.instructions}

Selected projectId: ${input.projectId}${'commentId' in input ? `
Selected commentId: ${input.commentId}` : ''}` } }] };
        });
    }
}
