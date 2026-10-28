export const KnownPages = {
    Landing: '/',
    HowItWorks: '/#how-it-works',
    Features: '/#features',
    GetStarted: '/#get-started',
    Pricing: '/#pricing',
    Faq: '/#faq',
    Brand: '/brand',
    OpenSource: '/open-source',
    Security: '/security',
    Status: '/status',
    Notifications: '/notifications',
    NotificationUnsubscribe: '/api/notifications/unsubscribe',

    App: '/app',
    AppSignIn: '/app/sign-in',
    AppSignInConfirm: '/app/sign-in/confirm',
    AppProjects: '/app/projects',
    AppNewProject: '/app/projects/new',
    AppUsers: '/app/users',
    AppClients: '/app/clients',
    AppInvitation: '/app/invitation',
    AppAccount: '/app/account',
    AppNotionConnect: '/app/notion/connect',
    AppNotionCallback: '/app/notion/callback',
    AppGitHubConnect: '/app/github/connect',
    AppGitHubSetup: '/app/github/setup',
    AppGitHubCallback: '/app/github/callback',
    AppLinearConnect: '/app/linear/connect',
    AppLinearCallback: '/app/linear/callback',
    AppSlackConnect: '/app/slack/connect',
    AppSlackCallback: '/app/slack/callback',
    GitHubWebhook: '/api/integrations/github/webhook',

    LegalPrivacyPolicy: '/legal/privacy-policy',
    LegalTermsOfService: '/legal/terms-of-service',
    LegalCookiePolicy: '/legal/cookie-policy',
    LegalAcceptableUsePolicy: '/legal/acceptable-use-policy',
    LegalSla: '/legal/sla'
} as const;

/** Pages with a parameter */
export const KnownPageLinks = {
    project: (projectId: string) => `/app/projects/${encodeURIComponent(projectId)}`,
    projectSettings: (projectId: string) => `/app/projects/${encodeURIComponent(projectId)}/settings`,
    /** The install guide; `onboarding` adds the progress of a project that was just created */
    projectInstall: (projectId: string, { onboarding = false }: { onboarding?: boolean } = {}) =>
        `/app/projects/${encodeURIComponent(projectId)}/install${onboarding ? '?onboarding=1' : ''}`,
    /** The screenshot of a project comment (an image, for the signed-in app) */
    projectCommentScreenshot: (projectId: string, commentId: string) =>
        `/app/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}/screenshot`,
    /** Opens a project URL in review mode, signed in, optionally at a comment (see app/review) */
    projectReview: (projectId: string, url?: string, commentId?: string) => {
        const query = new URLSearchParams();
        if (url)
            query.set('url', url);
        if (commentId)
            query.set('comment', commentId);
        const search = query.toString();
        return `/app/review/${encodeURIComponent(projectId)}${search ? `?${search}` : ''}`;
    },
    /** The projects list filtered to one client (the `client` filter of /app/projects) */
    clientProjects: (clientName: string, status: 'active' | 'done' = 'active') => {
        const query = new URLSearchParams();
        if (status === 'done')
            query.set('status', status);
        query.set('client', `name:${clientName}`);
        return `/app/projects?${query}`;
    }
} as const;
