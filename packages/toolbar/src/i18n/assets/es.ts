// The Spanish language asset (`../languageHandoff.ts`): published next to the review bundle as `language-es.js`.
import { es } from '../es';
import { lazyEs } from '../lazy/es';
import { handOverLanguage } from '../languageHandoff';

handOverLanguage({ language: 'es', messages: es, checks: lazyEs });
