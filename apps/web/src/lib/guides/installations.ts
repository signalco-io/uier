// Platform instructions reviewed against the first-party sources below on 15 November 2026.
// The script and CSP themselves stay in app/integration.ts, shared with project installation.
export const installationGuides = {
    html: {
        name: 'HTML',
        file: 'Shared HTML template · before </body>',
        placementTitle: 'Add the script to your pages',
        requirements: ['You need access to edit and publish the site’s HTML or shared page template.'],
        placement: [
            'Paste the script before the closing </body> tag in the shared template. With separate HTML files, add it to every page you want to review.',
            'Keep the project attribute and defer attribute. The toolbar is served by uier; your site still serves its own HTML and assets.'
        ],
        publish: 'Publish the edited files to the address configured in your project. Check a second page as well as the homepage.',
        navigation: 'Follow a normal link to another installed page, then reload it. A review continues in the same browser tab; each page still needs the script in its HTML.',
        surfaces: 'A shared footer covers only pages that use it. A separately hosted help centre or another origin needs its own installation and configured project address.',
        removal: 'Remove the script from the shared template and any individual HTML files where you added it. Publish those changes and clear any cached HTML.',
        problems: [
            { title: 'Only the homepage works', text: 'Inspect the second page’s HTML. A script in index.html does not install it in unrelated HTML files.' },
            { title: 'An older page still loads it', text: 'Check your host or CDN’s HTML cache and any service worker that serves an older copy.' }
        ],
        sources: [{ title: 'HTML script element', href: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script' }]
    },
    react: {
        name: 'React',
        file: 'index.html · before </body>',
        placementTitle: 'Install once in the HTML entry',
        requirements: ['You need access to the app’s HTML entry and deployment. This guide uses a script tag, so it needs no uier npm package.'],
        placement: [
            'In a Vite React app, open index.html at the project root. In an existing Create React App project, use public/index.html. Paste the script before </body>, outside the React root element.',
            'Keep your existing application entry script. Do not add another toolbar script in each route or a component that runs after every render. For a Next.js App Router site, use the separate Next.js guide.'
        ],
        publish: 'Build and deploy the app. Check the deployed HTML contains one toolbar script with your project code.',
        navigation: 'Use the app’s router to change pages, then try Back, Forward and a reload. The toolbar follows client-side navigation without another script. Configure meaningful query fields or hash routes in the project when they identify different views.',
        surfaces: 'Mounting and unmounting a route does not remove a script installed in the HTML document. Put the installation in the entry for the app you intend to review, rather than relying on component cleanup.',
        removal: 'Remove the toolbar script from the HTML entry, rebuild and redeploy the app. Refresh any service-worker cache that still serves the earlier HTML.',
        problems: [
            { title: 'Two toolbar scripts', text: 'Keep one installation in index.html. Remove duplicate route-level or effect-based injections instead of adding another copy after navigation.' },
            { title: 'Feedback belongs to the wrong view', text: 'Check the project’s page-state settings for meaningful query fields and hash routes. Unconfigured tracking queries do not create separate feedback pages.' }
        ],
        sources: [{ title: 'Vite’s HTML entry', href: 'https://vite.dev/guide/#index-html-and-project-root' }]
    },
    wordpress: {
        name: 'WordPress',
        file: 'Site-wide front-end footer',
        placementTitle: 'Add it to the front-end footer',
        requirements: [
            'Use an account that can add front-end scripts. WordPress.com requires a plugin-enabled plan with hosting features activated for custom JavaScript.',
            'On a self-hosted site, check the host’s restrictions and your theme’s footer support. A page editor may strip script tags.'
        ],
        placement: [
            'Use your site’s existing footer-code or code-snippet tool to add this complete HTML script tag to the front end, site-wide. Enable the snippet and save it.',
            'If a developer maintains a child theme, they can place the script before </body> in its footer template. Do not edit the parent theme. Block themes may need a footer hook or code-insertion tool rather than an editable footer.php.'
        ],
        publish: 'Open a published front-end page after saving. Clear WordPress page caches and any host or CDN cache so the new footer is served.',
        navigation: 'Post a test comment on one published page, then follow a link to another page and reload it. Check that both templates include the footer installation.',
        surfaces: 'This setup reviews the front-end pages that include the script. It does not install uier in wp-admin, the block editor, every embedded frame or pages rendered by a different theme or service.',
        removal: 'Disable or remove the footer snippet, or remove your child-theme addition. Save, publish as needed and clear the same page, host and CDN caches.',
        problems: [
            { title: 'The script disappears', text: 'Check the account’s code permissions and WordPress.com hosting features. A content block that filters JavaScript is not a site-wide installation.' },
            { title: 'Some templates miss the toolbar', text: 'Check that their footer runs the code-insertion tool or wp_footer hook. Theme-specific templates can omit it.' }
        ],
        sources: [
            { title: 'WordPress.com code restrictions', href: 'https://wordpress.com/support/code/' },
            { title: 'WordPress front-end footer hook', href: 'https://developer.wordpress.org/reference/hooks/wp_footer/' }
        ]
    },
    webflow: {
        name: 'Webflow',
        file: 'Site settings → Custom code → Footer code',
        placementTitle: 'Save the site’s Footer code',
        requirements: [
            'Webflow allows custom code with an active Site plan or an eligible Core, Growth, Agency or Freelancer Workspace. You need a Site manager or Designer role that can edit it.',
            'Have permission to publish to the staging or custom domain you will review.'
        ],
        placement: [
            'Open Site settings → Custom code. Add the complete script tag in Footer code, below any code already there, then choose Save changes.',
            'The site-wide footer applies before </body>. Add only the script tag, without another html, head or body wrapper. Do not also paste it into each page’s custom code.'
        ],
        publish: 'Publish the site to the chosen domains. Saving custom code alone does not update the published site; use that published address for the installation check.',
        navigation: 'Review a published page, follow a link to a second page and reload it. Configure the webflow.io staging origin and custom origin separately if you review both.',
        surfaces: 'Review published pages that include the footer. This installation does not promise access to the Webflow Designer, Editor, third-party frames or every preview surface.',
        removal: 'Remove the script from Footer code, save and publish again to every domain where you installed it. Check page-level custom code for any duplicate copy.',
        problems: [
            { title: 'Custom code is unavailable', text: 'Check your Site or Workspace plan and site role against Webflow’s current requirements.' },
            { title: 'Saved but missing on the site', text: 'Publish to the exact domain you are opening. A staging domain and custom domain are different origins in the project.' }
        ],
        sources: [
            { title: 'Webflow custom code and publication', href: 'https://help.webflow.com/hc/en-us/articles/33961357265299-Custom-code-in-head-and-body-tags' },
            { title: 'Webflow custom security headers', href: 'https://help.webflow.com/hc/en-us/articles/46651836279059-Custom-security-headers' }
        ]
    },
    shopify: {
        name: 'Shopify',
        file: 'layout/theme.liquid · before </body>',
        placementTitle: 'Add it to the storefront layout',
        requirements: [
            'Use an account with permission to edit Online Store theme code. Duplicate the theme before editing; a trial copy of a paid theme must be purchased before its code can be changed.',
            'Choose the theme and storefront address you intend to review. The example is a theme-code installation, not a Shopify app.'
        ],
        placement: [
            'In the Shopify admin, open Online Store → Themes. Open the chosen theme’s menu and choose Edit code.',
            'Open layout/theme.liquid. Paste the complete script tag just before </body>, preserving the existing Liquid and scripts, then save.'
        ],
        publish: 'Check the chosen theme on the storefront. Editing an unpublished duplicate does not change the live theme; publish it when appropriate, or use its actual preview address and check that origin in the project.',
        navigation: 'Save feedback on a product or content page that uses theme.liquid, then navigate to another storefront page and reload. Check alternative layouts independently.',
        surfaces: 'The theme layout covers only pages that render it. It does not install the toolbar in Shopify admin, checkout, new customer-account pages, the theme editor or third-party frames. A password page, legacy account template or alternative layout needs a separate check.',
        removal: 'Remove the script from each theme or layout where you added it, save and publish the intended theme. Recheck after theme updates, which can replace custom code.',
        problems: [
            { title: 'The live store has no script', text: 'Check which theme you edited and which one is published. Previewing a duplicate is different from opening the live storefront.' },
            { title: 'A checkout page has no toolbar', text: 'Storefront theme code does not apply to every Shopify surface. Use the supported storefront pages rather than adding checkout or account customizations from this guide.' }
        ],
        sources: [
            { title: 'Shopify theme-code editing and backups', href: 'https://help.shopify.com/en/manual/online-store/themes/customizing-themes/edit-code/edit-theme-code' },
            { title: 'Shopify layout coverage', href: 'https://shopify.dev/docs/storefronts/themes/architecture/layouts' },
            { title: 'Shopify checkout and account pages', href: 'https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/checkout-editor' }
        ]
    }
} as const;

export type InstallationGuideKey = keyof typeof installationGuides;
export const installationSourcesCheckedOn = '2026-11-15';
