/** @type {import('next-sitemap').IConfig} */

module.exports = {
    siteUrl: process.env.SITE_URL || 'https://uier.io',
    generateRobotsTxt: true,
    // The signed-in app is not for search engines
    exclude: ['/app', '/app/*'],
    robotsTxtOptions: {
        policies: [{ userAgent: '*', allow: '/', disallow: ['/app'] }]
    }
}
