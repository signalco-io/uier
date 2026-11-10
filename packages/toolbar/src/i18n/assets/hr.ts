// The Croatian language asset (`../languageHandoff.ts`): published next to the review bundle as `language-hr.js`.
import { hr } from '../hr';
import { lazyHr } from '../lazy/hr';
import { handOverLanguage } from '../languageHandoff';

handOverLanguage({ language: 'hr', messages: hr, checks: lazyHr });
