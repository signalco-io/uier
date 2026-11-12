import { aiSearchSections } from './AiSearchSection';
import { altTextSections } from './AltTextSection';
import { crawlerSections } from './CrawlerSection';
import { keyboardSections } from './KeyboardSection';
import { motionSections } from './MotionSection';
import { pageExtrasSections } from './pageExtras';
import { reflowSections } from './ReflowSection';
import { screenReaderSections } from './ScreenReaderSection';
import { sharingSections } from './SharingSection';
import { structuredDataSections } from './StructuredDataSection';
import { consentSnapshot, consentObservation, securitySnapshot, securityHeaders } from '../SecurityPanel';
import type { SectionDefinition } from './sections';

/**
 * Every section whose checks run on demand, in the order the background checks run them. An area's
 * file lists its own definitions, so adding one changes only that file.
 */
export const sectionDefinitions: readonly SectionDefinition[] = [
    consentSnapshot, consentObservation, securitySnapshot, securityHeaders, ...pageExtrasSections, ...sharingSections, ...structuredDataSections, ...crawlerSections, ...aiSearchSections,
    ...keyboardSections, ...screenReaderSections, ...altTextSections, ...reflowSections, ...motionSections
];
