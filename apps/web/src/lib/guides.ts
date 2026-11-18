import { mcpGuide } from './guides/mcp';

export const guides = {
    mcp: mcpGuide,
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
    html: {
        title: 'Add website feedback to HTML',
        description: 'Add the toolbar to a shared HTML template, check a saved comment and remove the installation when the review ends.',
        path: '/guides/html',
        section: 'Guides'
    },
    react: {
        title: 'Add website feedback to React',
        description: 'Install the toolbar once in a React site’s HTML entry, then check feedback across client-side navigation.',
        path: '/guides/react',
        section: 'Guides'
    },
    wordpress: {
        title: 'Add website feedback to WordPress',
        description: 'Place the toolbar in your WordPress site’s front-end footer and check the published pages with a review link.',
        path: '/guides/wordpress',
        section: 'Guides'
    },
    webflow: {
        title: 'Add website feedback to Webflow',
        description: 'Add the toolbar through Webflow’s Footer code, publish the site and check feedback on its configured addresses.',
        path: '/guides/webflow',
        section: 'Guides'
    },
    shopify: {
        title: 'Add website feedback to Shopify',
        description: 'Add the toolbar to an Online Store theme and review the storefront pages that use that layout.',
        path: '/guides/shopify',
        section: 'Guides'
    },
    browserExtension: {
        title: 'Set up the browser extension',
        description: 'Set up the uier extension in Chrome, Edge or Firefox and review a project site without adding the script.',
        path: '/guides/browser-extension',
        section: 'Guides'
    },
    reviewChecklist: {
        title: 'Website review checklist',
        description: 'Scope a human review, check content and journeys, and turn findings into a clear handoff.',
        path: '/guides/website-review-checklist',
        section: 'Guides'
    },
    bugReport: {
        title: 'Website bug-report template',
        description: 'Copy a practical report template, follow a filled example and give a developer enough context to reproduce a bug.',
        path: '/guides/website-bug-report-template',
        section: 'Guides'
    },
    index: {
        title: 'Guides',
        description: 'Practical guides for installing uier and reviewing a live website with your team or client.',
        path: '/guides',
        section: 'Resources'
    }
} as const;
