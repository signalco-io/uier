import type { PageFixture } from './types';
import aiSearch from './aiSearch';
import content from './content';
import crawler from './crawler';
import keyboard from './keyboard';
import report from './report';
import seoHead from './seoHead';
import seoPage from './seoPage';
import site from './site';
import verify from './verify';

/** The fixtures by the name in their origin: `site.origin('fixture-<name>')` */
export const fixtures: Record<string, PageFixture | undefined> = {
    'ai-search': aiSearch,
    'content': content,
    'crawler': crawler,
    'keyboard': keyboard,
    'report': report,
    'seo-head': seoHead,
    'seo-page': seoPage,
    'site': site,
    'verify': verify,
};
