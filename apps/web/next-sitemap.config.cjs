/** @type {import('next-sitemap').IConfig} */

module.exports = {
    siteUrl: process.env.SITE_URL || 'https://uier.io',
    generateRobotsTxt: true,
    // The signed-in app is not for search engines, and a page's social card is an image, not a page
    exclude: ['/app', '/app/*', '/review-verification', '/review-session', '/*/opengraph-image*'],
    robotsTxtOptions: {
        policies: [{ userAgent: '*', allow: '/', disallow: ['/app'] }]
    }
}
