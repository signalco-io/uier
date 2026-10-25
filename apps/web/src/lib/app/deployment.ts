/** Pure deployment context, usable by both Next.js requests and scheduled workers. */
export function deploymentEnvironment(): 'production' | 'preview' | undefined {
    const value = process.env.UIER_DEPLOYMENT_ENV || process.env.VERCEL_ENV;
    return value === 'production' || value === 'preview' ? value : undefined;
}
