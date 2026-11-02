/** @type {import('next-sitemap').IConfig} */

module.exports = {
    siteUrl: process.env.SITE_URL || 'https://uier.io',
    generateRobotsTxt: true,
    // Only indexable pages belong in the sitemap, not app flows, bridges or metadata assets.
    exclude: ['/api', '/api/*', '/app', '/app/*', '/notifications', '/review-verification',
        '/review-session', '/extension-verification', '/manifest.webmanifest', '/opengraph-image'],
    // A build time is not the date the content changed. Omit it until actual dates are tracked.
    autoLastmod: false,
    changefreq: undefined,
    priority: undefined,
    // This public page renders dynamically, so it is absent from the prerender manifest.
    additionalPaths: async () => [{ loc: '/status' }],
    robotsTxtOptions: {
        // Crawlers must fetch the app and bridge pages to see their noindex directives.
        // Authentication protects app data; robots.txt does not control access or indexing.
        policies: [{ userAgent: '*', allow: '/' }]
    }
}
