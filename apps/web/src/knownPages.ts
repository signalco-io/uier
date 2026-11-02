export const KnownPages = {
    Landing: '/',
    HowItWorks: '/#how-it-works',
    Features: '/#features',
    GetStarted: '/#get-started',
    Pricing: '/#pricing',
    Faq: '/#faq',
    FeedbackTriage: '/features/feedback-triage',
    Brand: '/brand',
    Integrations: '/integrations',
    OpenSource: '/open-source',
    Security: '/security',
    Status: '/status',
    Notifications: '/notifications',
    NotificationUnsubscribe: '/api/notifications/unsubscribe',

    App: '/app',
    AppExtension: '/app/extension',
    AppSignIn: '/app/sign-in',
    AppSignInConfirm: '/app/sign-in/confirm',
    AppSignInMicrosoft: '/app/sign-in/microsoft',
    AppSignInMicrosoftCallback: '/app/sign-in/microsoft/callback',
    AppSignInMicrosoftLink: '/app/sign-in/microsoft/link',
    AppSignInGoogle: '/app/sign-in/google',
    AppSignInGoogleCallback: '/app/sign-in/google/callback',
    AppSignInGoogleLink: '/app/sign-in/google/link',
    AppProjects: '/app/projects',
    AppReview: '/app/review',
    AppNewProject: '/app/projects/new',
    AppUsers: '/app/users',
    AppTeams: '/app/teams',
    AppClients: '/app/clients',
    AppInvitation: '/app/invitation',
    AppAccount: '/app/account',
    AppSettings: '/app/settings',
    AppNotionConnect: '/app/notion/connect',
    AppNotionCallback: '/app/notion/callback',
    AppGitHubConnect: '/app/github/connect',
    AppGitHubSetup: '/app/github/setup',
    AppGitHubCallback: '/app/github/callback',
    AppGitHubError: '/app/github/error',
    AppLinearConnect: '/app/linear/connect',
    AppLinearCallback: '/app/linear/callback',
    AppAzureDevOpsConnect: '/app/azure-devops/connect',
    AppAzureDevOpsCallback: '/app/azure-devops/callback',
    AppSlackConnect: '/app/slack/connect',
    AppSlackCallback: '/app/slack/callback',
    GitHubWebhook: '/api/integrations/github/webhook',

    LegalPrivacyPolicy: '/legal/privacy-policy',
    LegalTermsOfService: '/legal/terms-of-service',
    LegalCookiePolicy: '/legal/cookie-policy',
    LegalAcceptableUsePolicy: '/legal/acceptable-use-policy',
    LegalSla: '/legal/sla'
} as const;

/** The sections of a project's settings, each its own page under the settings (General is the settings page itself) */
export type ProjectSettingsSection = 'review' | 'environments' | 'installation' | 'people' | 'integrations' | 'notifications' | 'danger-zone';

/** Pages with a parameter */
export const KnownPageLinks = {
    integration: (provider: string) => `/integrations/${encodeURIComponent(provider)}`,
    team: (id: string) => `/app/teams/${encodeURIComponent(id)}`,
    member: (id: string) => `/app/users/${encodeURIComponent(id)}`,
    project: (projectId: string) => `/app/projects/${encodeURIComponent(projectId)}`,
    /** A project's settings: General, or one of its other sections */
    projectSettings: (projectId: string, section?: ProjectSettingsSection) =>
        `/app/projects/${encodeURIComponent(projectId)}/settings${section ? `/${section}` : ''}`,
    /** One connected service of a project (Settings → Integrations → its page); OAuth returns land here */
    projectIntegration: (projectId: string, provider: string) =>
        `/app/projects/${encodeURIComponent(projectId)}/settings/integrations/${encodeURIComponent(provider)}`,
    /** The install guide (Settings → Installation); `onboarding` is the install step of a project that was just created */
    projectInstall: (projectId: string, { onboarding = false }: { onboarding?: boolean } = {}) => onboarding
        ? `/app/projects/${encodeURIComponent(projectId)}/install?onboarding=1`
        : `/app/projects/${encodeURIComponent(projectId)}/settings/installation`,
    /** The screenshot of a project comment (an image, for the signed-in app) */
    projectCommentScreenshot: (projectId: string, commentId: string) =>
        `/app/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}/screenshot`,
    /** Consent for a coding tool's OAuth sign-in to the MCP endpoint (a stored authorization request) */
    mcpConnect: (requestId: string) => `/app/connect/${encodeURIComponent(requestId)}`,
    /** An authorization request that cannot go back to its client (unknown client or redirect URI) */
    mcpConnectError: (error: string) => `/app/connect/error?error=${encodeURIComponent(error)}`,
    /** Opens a project URL in review mode, signed in, optionally at a comment (see app/review) */
    projectReview: (projectId: string, url?: string, commentId?: string) => {
        const query = new URLSearchParams();
        if (url)
            query.set('url', url);
        if (commentId)
            query.set('comment', commentId);
        const search = query.toString();
        return `${KnownPages.AppReview}/${encodeURIComponent(projectId)}${search ? `?${search}` : ''}`;
    },
    /** A social card (Open Graph image) from `src/lib/social/cards.ts` */
    socialCard: (card: string) => `/og/${encodeURIComponent(card)}`,
    /** The projects list filtered to one client by its id (the `client` filter of /app/projects) */
    clientProjects: (clientId: string, status: 'active' | 'done' = 'active') => {
        const query = new URLSearchParams();
        if (status === 'done')
            query.set('status', status);
        query.set('client', clientId);
        return `/app/projects?${query}`;
    }
} as const;
