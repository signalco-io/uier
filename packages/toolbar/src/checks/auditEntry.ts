// The accessibility audit asset (`dist/audit.js`, published as `/toolbar/<sha256>.js`): axe-core,
// loaded by the review bundle only when the Accessibility panel runs a check (`axeLoader.ts`), never
// with the review bundle itself and never for ordinary visitors. The order of these imports matters:
// the prelude saves the page's globals before axe-core initializes.
import { restorePageGlobals } from './auditPrelude';
import axe from 'axe-core';
import { auditHandoffKey, type AuditScript } from './auditHandoff';

restorePageGlobals();
(document.currentScript as AuditScript | null)?.[auditHandoffKey]?.(axe);
