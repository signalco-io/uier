// The page checks that run on demand, in the audit asset (`dist/audit.js`, with axe-core): the review
// bundle gets them through the audit handoff (`loadChecks` in `../axeLoader.ts`), never by importing
// this file. One module per area; whatever a module exports is its part of `LazyChecks`, so adding a
// check changes only its own module. Modules here must not import React, the UI kit, hooks or
// components: they read the page and return plain data (docs/page-checks.md, "Sections").
import * as accessibilityReport from './accessibilityReport';
import * as aiSearch from './aiSearch';
import * as altText from './altText';
import * as crawler from './crawler';
import * as keyboard from './keyboard';
import * as locale from './locale';
import * as motion from './motion';
import * as pageExtras from './pageExtras';
import * as reflow from './reflow';
import * as screenReader from './screenReader';
import * as sharing from './sharing';
import * as structuredData from './structuredData';

export const lazyChecks = { accessibilityReport, aiSearch, altText, crawler, keyboard, locale, motion, pageExtras, reflow, screenReader, sharing, structuredData };
export type LazyChecks = typeof lazyChecks;
