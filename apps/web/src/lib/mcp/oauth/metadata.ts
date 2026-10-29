import { mcpScopes } from '../scopes';
import { mcpResource, protectedResourceMetadataPath } from './config';

/** RFC 9728 protected resource metadata of the MCP endpoint */
export function protectedResourceMetadata(issuer: string) {
    return {
        resource: mcpResource(issuer),
        authorization_servers: [issuer],
        scopes_supported: [...mcpScopes],
        bearer_methods_supported: ['header'],
        resource_name: 'uier'
    };
}

/** RFC 8414 authorization server metadata. uier is its own authorization server, for the MCP endpoint only. */
export function authorizationServerMetadata(issuer: string) {
    return {
        issuer,
        authorization_endpoint: `${issuer}/api/oauth/authorize`,
        token_endpoint: `${issuer}/api/oauth/token`,
        registration_endpoint: `${issuer}/api/oauth/register`,
        revocation_endpoint: `${issuer}/api/oauth/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        scopes_supported: [...mcpScopes],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true
    };
}

/** The 401 challenge of the MCP endpoint. `invalid_token` only when a token was presented. */
export function bearerChallenge(issuer: string, tokenPresented: boolean) {
    return `Bearer realm="uier MCP", resource_metadata="${issuer}${protectedResourceMetadataPath}", scope="feedback:read"${tokenPresented ? ', error="invalid_token"' : ''}`;
}

export const publicMetadataHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff'
} as const;
