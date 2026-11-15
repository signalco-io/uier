import { KnownPages } from '@/src/knownPages';

// Acquisition pages describe a distinct review situation. Product details stay with the linked
// feature pages; titles, descriptions and social cards share these entries.
export const useCases = {
    clientFeedback: {
        title: 'Client website feedback',
        description: 'Collect client feedback on a live website, discuss each finding and give the next change an owner.',
        path: KnownPages.ClientFeedback,
        section: 'Use cases'
    },
    bugReporting: {
        title: 'Visual website bug reporting',
        description: 'Report a website bug with the page, expected result, reproduction steps and the evidence you choose to send.',
        path: KnownPages.BugReporting,
        section: 'Use cases'
    },
    userAcceptanceTesting: {
        title: 'Manual user acceptance testing',
        description: 'Plan a manual website acceptance review, collect findings in the right environment and ask reviewers to check individual fixes.',
        path: KnownPages.UserAcceptanceTesting,
        section: 'Use cases'
    }
} as const;
