// The Italian language asset (`../languageHandoff.ts`): published next to the review bundle as `language-it.js`.
import { it } from '../it';
import { lazyIt } from '../lazy/it';
import { handOverLanguage } from '../languageHandoff';

handOverLanguage({ language: 'it', messages: it, checks: lazyIt });
