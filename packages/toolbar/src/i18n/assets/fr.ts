// The French language asset (`../languageHandoff.ts`): published next to the review bundle as `language-fr.js`.
import { fr } from '../fr';
import { lazyFr } from '../lazy/fr';
import { handOverLanguage } from '../languageHandoff';

handOverLanguage({ language: 'fr', messages: fr, checks: lazyFr });
