export const guides = {
    clientReviews: {
        title: 'Review a website with a client',
        description: 'Collect feedback on a live site, assign the next step, and ask the reporter to verify the fix.',
        path: '/guides/client-website-reviews',
        section: 'Guides'
    },
    nextJs: {
        title: 'Add website feedback to Next.js',
        description: 'Install the uier toolbar in the App Router with next/script and check it on your project’s site.',
        path: '/guides/nextjs',
        section: 'Guides'
    },
    browserExtension: {
        title: 'Set up the browser extension',
        description: 'Set up the uier extension, check Firefox availability, and review a project site without adding the script.',
        path: '/guides/browser-extension',
        section: 'Guides'
    },
    index: {
        title: 'Guides',
        description: 'Practical guides for installing uier and reviewing a live website with your team or client.',
        path: '/guides',
        section: 'Resources'
    }
} as const;
