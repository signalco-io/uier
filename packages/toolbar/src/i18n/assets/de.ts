// The German language asset (`../languageHandoff.ts`): published next to the review bundle as `language-de.js`.
import { de } from '../de';
import { lazyDe } from '../lazy/de';
import { handOverLanguage } from '../languageHandoff';

handOverLanguage({ language: 'de', messages: de, checks: lazyDe });
