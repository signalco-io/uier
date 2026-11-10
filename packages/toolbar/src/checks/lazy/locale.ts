import { lazyEn, type LazyMessages } from '../../i18n/lazy/en';

// The language of the on-demand checks' words (docs/localization.md). The audit asset carries English;
// before each run the review bundle hands over the toolbar's language and, for any other language, the
// strings it loaded with that language's asset (`axeLoader.ts`), so a report is in the language the
// toolbar showed when it ran.

let current: LazyMessages = lazyEn;

/** The toolbar's language for the checks that run next, with its strings; without them, English */
export function use(language: string, strings?: LazyMessages) {
    current = language !== 'en' && strings ? strings : lazyEn;
}

/** The current language's strings, read as a check runs */
export function words(): LazyMessages {
    return current;
}
