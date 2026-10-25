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

    App: '/app',
    AppSignIn: '/app/sign-in',
    AppSignInConfirm: '/app/sign-in/confirm',
    AppProjects: '/app/projects',
    AppNewProject: '/app/projects/new',
    AppUsers: '/app/users',
    AppInviteUser: '/app/users/invite',
    AppInvitation: '/app/invitation',
    AppAccount: '/app/account',

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
    projectInstall: (projectId: string) => `/app/projects/${encodeURIComponent(projectId)}/install`,
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
    }
} as const;
