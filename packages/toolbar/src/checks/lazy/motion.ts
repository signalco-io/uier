import { elementLabel, foundLine, isRendered, isToolbarNode, writtenAddress } from '../pageElements';
import type { PageCheck, PageIssue } from '../types';
import { pageCheck, pageIssue, type SectionContext, type SectionReport } from './api';
import { words } from './locale';

// Motion (packages/toolbar/docs/page-checks-content.md): what moves on its own for more than five
// seconds (WCAG 2.2.2), when the panel checks. The toolbar cannot tell whether the page offers a way
// to pause it, so each is a finding to review. `marquee` and `blink` elements are axe-core's own
// rules (`marquee`, `blink`) in the audit above, so they are not listed again here.

/** WCAG 2.2.2: motion that starts on its own and lasts longer than this needs a way to pause it */
const limit = 5000;

/** The line every issue shares (one issue's), as the check's value: the rows then show only their elements */
const shared = (issues: readonly PageIssue[]) => issues.every(issue => issue.summary === issues[0]?.summary) ? issues[0]?.summary : undefined;

/** An animation's name as the page wrote it: a CSS animation's, a transition's property, or a script's id */
function animationName(animation: Animation) {
    return animation instanceof CSSAnimation ? animation.animationName
        : animation instanceof CSSTransition ? `transition of ${animation.transitionProperty}` : animation.id;
}

type Moving = { element: Element; endless: boolean; seconds: number; names: Set<string> };

/** Whether a marquee moves the element (axe-core reports the marquee) */
function inMarquee(element: Element) {
    const root = element.getRootNode();
    return !!(element.closest('marquee') || (root instanceof ShadowRoot && root.host.closest('marquee')));
}

/** The page's running animations by element: rendered, not the toolbar's, and whether any runs long */
function runningAnimations() {
    const elements = new Map<Element, Moving>();
    let any = false;
    for (const animation of document.getAnimations()) {
        const effect = animation.effect;
        if (!(effect instanceof KeyframeEffect)) continue;
        const target = effect.target;
        // Also inside the toolbar's shadow root (its spinners never end)
        if (!target || animation.playState !== 'running' || isToolbarNode(target) || !isRendered(target)) continue;
        any = true;
        const active = Number(effect.getComputedTiming().activeDuration ?? 0) / (Math.abs(animation.playbackRate) || 1);
        if (active <= limit || inMarquee(target)) continue;
        const moving = elements.get(target) ?? { element: target, endless: false, seconds: 0, names: new Set<string>() };
        moving.endless ||= !Number.isFinite(active);
        if (Number.isFinite(active)) moving.seconds = Math.max(moving.seconds, Math.round(active / 1000));
        const name = animationName(animation);
        if (name) moving.names.add(name);
        elements.set(target, moving);
    }
    return { any, long: [...elements.values()] };
}

/** Whether any stylesheet the page lets us read has a `prefers-reduced-motion` rule; other origins' cannot be read */
function reducedMotionRule() {
    const condition = /prefers-reduced-motion/i;
    const seen = new Set<CSSStyleSheet>();
    const inRules = (rules: CSSRuleList): boolean => [...rules].some(rule => {
        if (rule instanceof CSSImportRule) return condition.test(rule.media.mediaText) || (!!rule.styleSheet && inSheet(rule.styleSheet));
        if (rule instanceof CSSMediaRule && condition.test(rule.media.mediaText)) return true;
        // Inside @supports, @layer, @container and nested rules
        return 'cssRules' in rule && inRules((rule as CSSGroupingRule).cssRules);
    });
    const inSheet = (sheet: CSSStyleSheet): boolean => {
        if (seen.has(sheet)) return false;
        seen.add(sheet);
        if (condition.test(sheet.media.mediaText)) return true;
        try {
            return inRules(sheet.cssRules);
        } catch {
            return false; // Another origin's
        }
    };
    return [...document.styleSheets, ...document.adoptedStyleSheets].some(inSheet);
}

/** A media element's length, in words */
function mediaLength(media: HTMLMediaElement) {
    const { length } = words().motion;
    if (media.loop) return length.loop;
    if (media.duration === Infinity) return length.endless;
    return Number.isFinite(media.duration) ? length.seconds(Math.round(media.duration)) : length.unknown;
}

/** Whether an image's address is a GIF, by its file name or its `data:` type (not by its content) */
const gif = (address: string) => /^data:image\/gif[;,]/i.test(address) || /\.gif$/i.test(address.replace(/[?#].*$/, ''));

/**
 * What moves on the page now: running animations (CSS animations, transitions, the Web Animations
 * API) that never end or run longer than five seconds, and video and audio that play on their own
 * for longer without controls; then notes: GIF images, which may animate, and, when the page
 * animates, whether its readable stylesheets respond to `prefers-reduced-motion`.
 */
export function checkMotion({ path }: SectionContext): SectionReport {
    const { motion: t, found } = words();
    const animations = runningAnimations();
    const checks: PageCheck[] = [];
    const animated = animations.long.map(({ element, endless, seconds, names }) => {
        const summary = endless ? t.animatesEndless : t.animatesFor(seconds);
        return pageIssue(path, { type: 'accessibility', id: 'motion-animation' }, element, summary,
            `${t.animationComment(summary)}${foundLine(found.animation, [...names].join(', '))}${foundLine(found.element, elementLabel(element))}`);
    });
    checks.push(animated.length
        ? pageCheck('motion-animation', t.animations, 'warn', t.animated(animated.length),
            { issues: animated, value: shared(animated) })
        : pageCheck('motion-animation', t.animations, 'pass', t.noAnimation));

    const players = [...document.querySelectorAll<HTMLMediaElement>('video, audio')].filter(media => !isToolbarNode(media) && !media.controls
        && (media.autoplay || !media.paused) && (media.loop || !(media.duration <= limit / 1000)));
    if (players.length) {
        const issues = players.map(media => {
            const video = media instanceof HTMLVideoElement;
            const sound = media.muted ? '' : t.sound;
            // Audio without controls takes no room on the page: its comment is about the page
            return pageIssue(path, { type: 'accessibility', id: 'motion-media' }, isRendered(media) ? media : undefined, t.mediaSummary(video, mediaLength(media)),
                `${t.mediaComment(video, mediaLength(media))}${sound}${foundLine(video ? found.video : found.audio, writtenAddress(media.currentSrc || media.getAttribute('src')))}`);
        });
        checks.push(pageCheck('motion-media', t.media, 'warn', t.players(players.length),
            { issues, value: shared(issues) }));
    }

    // GIFs by address (one shown twice is one); whether one animates cannot be read from the page
    const gifs = new Map<string, HTMLImageElement>();
    for (const image of document.images) {
        const address = image.currentSrc || image.src;
        if (!address || !gif(address) || isToolbarNode(image)) continue;
        const first = gifs.get(address);
        if (!first || (!isRendered(first) && isRendered(image))) gifs.set(address, image);
    }
    if (gifs.size) {
        const issues: PageIssue[] = [...gifs].map(([address, image]) => pageIssue(path, { type: 'accessibility', id: 'motion-gif' }, isRendered(image) ? image : undefined, t.gifSummary,
            `${t.gifComment}${foundLine(found.image, writtenAddress(address))}`));
        checks.push(pageCheck('motion-gif', t.gifs, 'none', t.gifNote(gifs.size), { issues }));
    }

    // Only where something moves: a running animation, a player or a marquee
    if (animations.any || players.length || document.querySelector('marquee')) {
        const browser = matchMedia('(prefers-reduced-motion: reduce)').matches ? t.browserReduces : '';
        checks.push(pageCheck('motion-reduced', t.reduced, 'none', reducedMotionRule() ? t.reducedRule(browser) : t.noReducedRule(browser)));
    }
    return { checks };
}
