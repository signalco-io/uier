// Limits shared by the app's forms (client) and its server-side validation

export const MAX_NAME_LENGTH = 80;
export const MAX_WORKSPACE_NAME_LENGTH = 80;
/** Workspaces one person can create, their own first workspace included */
export const MAX_CREATED_WORKSPACES = 20;
export const MAX_PROJECT_NAME_LENGTH = 80;
export const MAX_CLIENT_NAME_LENGTH = 80;
export const MAX_CLIENT_DESCRIPTION_LENGTH = 280;
export const MAX_PROJECT_BRIEF_LENGTH = 2000;
export const MAX_PROJECT_URLS = 10;
export const MAX_ACTIVE_TEAMS = 100;
export const MAX_TEAMS_PER_MEMBER = 50;
export const MAX_TEAM_PROJECTS = 200;
export const MAX_BULK_PEOPLE = 50;
export const MAX_TEAM_NAME_LENGTH = 80;
export const MAX_TEAM_DESCRIPTION_LENGTH = 500;
export const MAX_PASSKEYS = 10;
export const MAX_PASSKEY_NAME_LENGTH = 60;
export const ACCESS_EVENT_TTL_SECONDS = 180 * 24 * 60 * 60;
/** Email domains one workspace offers (each must be the domain of an adding admin's own email) */
export const MAX_WORKSPACE_DOMAINS = 10;
/** Workspaces one sign-in looks at for an email domain */
export const MAX_DOMAIN_WORKSPACES = 20;
