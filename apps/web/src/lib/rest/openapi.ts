import { z } from 'zod';
import { apiPageLimit, apiRequestLimit, apiRoot, replyBody, responses, statusBody } from './contract';

const documentSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { target: 'openapi-3.0' });
const json = (schema: object) => ({ 'application/json': { schema } });
const feedback = '/projects/{projectId}/feedback';
const thread = feedback + '/{feedbackId}';
const parameter = (name: string, where: 'path' | 'query' | 'header', description: string, schema: object = { type: 'string' }) =>
    ({ name, in: where, description, required: where !== 'query', schema });
const projectId = parameter('projectId', 'path', 'Project ID returned by listProjects.');
const feedbackId = parameter('feedbackId', 'path', 'Feedback ID returned by listFeedback.');
const key = parameter('Idempotency-Key', 'header', 'Choose one key per intended write. Retry with the same token, project, key and input. Receipts last 30 days.',
    { type: 'string', pattern: '^[A-Za-z0-9_-]{16,128}$' });
const errors = {
    '400': 'Invalid input', '401': 'Missing, invalid, expired or revoked REST token', '403': 'Insufficient permission',
    '404': 'Resource is missing or inaccessible', '409': 'Conflicting write or idempotency key', '413': 'Request body too large',
    '415': 'Expected application/json', '429': 'Rate limit reached', '500': 'Unexpected server error', '503': 'Temporarily unavailable'
};
type ErrorStatus = keyof typeof errors;
function failure(status: ErrorStatus) {
    const response = { description: errors[status], content: json({ $ref: '#/components/schemas/Error' }) };
    if (status === '401') return { ...response, headers: { 'WWW-Authenticate': { schema: { type: 'string' } } } };
    if (status === '429') return { ...response, headers: {
        'Retry-After': { description: 'Seconds before retrying.', schema: { type: 'integer' } }
    } };
    return response;
}
function operation(operationId: keyof typeof responses, summary: string, description: string, parameters: ReturnType<typeof parameter>[] = [], body?: z.ZodType) {
    const failures: ErrorStatus[] = ['401', '403', '429', '500', '503'];
    if (parameters.some(parameter => parameter.in === 'path')) failures.push('404');
    if (body || parameters.some(parameter => parameter.in === 'query')) failures.push('400');
    if (body) failures.push('409', '413', '415');
    return {
        operationId, summary, description, parameters,
        ...(body ? { requestBody: { required: true, content: json(documentSchema(body)) } } : {}),
        responses: {
            '200': { description: 'Success', content: json(documentSchema(responses[operationId])) },
            ...Object.fromEntries(failures.map(status => [status, failure(status)]))
        }
    };
}

export const openapi = {
    openapi: '3.0.3',
    info: { title: 'uier REST API', version: '1.0.0',
        description: `Use a bearer token from [Account → API tokens](/app/account/api-tokens). Choose projects and permissions when creating it. Access follows current project membership and private-thread visibility. Each token allows up to ${apiRequestLimit} requests per minute. Replies also use the project’s reply limits. Interactive requests act on real project data.` },
    servers: [{ url: apiRoot }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', description: 'Paste a uier REST API token.' } },
        schemas: { Error: { type: 'object', required: ['error', 'message'], properties: { error: { type: 'string' }, message: { type: 'string' },
            reason: { type: 'string' }, usage: { type: 'string' } } } } },
    paths: {
        '/projects': { get: operation('listProjects', 'List projects', 'Requires feedback:read. Returns the selected projects you can still access.') },
        '/projects/{projectId}/statuses': { get: operation('listStatuses', 'List workflow statuses', 'Requires feedback:read. Use these IDs when updating feedback.', [projectId]) },
        [feedback]: { get: operation('listFeedback', 'List feedback', 'Requires feedback:read. Returns visible threads, newest first, including archived threads. Pass next as before until next is null. Reading leaves the thread’s read state alone.', [
            projectId, parameter('limit', 'query', 'Number of threads per page.', { type: 'integer', minimum: 1, maximum: apiPageLimit, default: 25 }),
            parameter('before', 'query', 'Continuation token from the previous response.')
        ]) },
        [thread]: { get: operation('getFeedback', 'Read a feedback thread', 'Requires feedback:read. Deleted messages have null text and author.', [projectId, feedbackId]),
            patch: operation('updateStatus', 'Update feedback status', 'Requires feedback:status. Existing workflow and verification rules apply. Returns the thread.', [projectId, feedbackId, key], statusBody) },
        [thread + '/replies']: { post: operation('reply', 'Reply to feedback', 'Requires feedback:reply. Posts a plain text or Markdown reply attributed to the named integration. Returns the thread.', [projectId, feedbackId, key], replyBody) }
    }
};
