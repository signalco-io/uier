/** @type {import('next-sitemap').IConfig} */

module.exports = {
    siteUrl: process.env.SITE_URL || 'https://uier.io',
    generateRobotsTxt: true,
    // The signed-in app is not for search engines
    exclude: ['/app', '/app/*', '/review-verification', '/review-session', '/og/*'],
    robotsTxtOptions: {
        // Link previews (Slack, X, LinkedIn) follow robots.txt and are fetched signed out: a shared
        // comment, review, project or invitation link ends at sign in or the invitation, which
        // show only the link's social card (src/lib/social) and are noindex like the rest of /app.
        policies: [{ userAgent: '*', allow: ['/', '/app/review/', '/app/projects/', '/app/sign-in', '/app/invitation'], disallow: ['/app'] }]
    }
}
