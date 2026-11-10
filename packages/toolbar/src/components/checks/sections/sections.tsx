import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { LoaderSpinner } from '@signalco/ui-icons';
import { auditAvailable, loadChecks } from '../../../checks/axeLoader';
import type { LazyChecks } from '../../../checks/lazy';
import type { SectionContext, SectionReport } from '../../../checks/lazy/api';
import { nextIdle } from '../../../checks/pageIdle';
import type { PageCheck } from '../../../checks/types';
import { CheckItem, CheckSection } from '../ChecksParts';
import type { ChecksPanelId } from '../PageChecks';
import { useMessages } from '../../../i18n';

// The panels' sections whose checks run on demand, in the audit asset (packages/toolbar/docs/page-checks.md,
// "Sections"). A section is a definition (which panel, when it runs, what it runs) and a component
// that shows its report; `PageChecks` keeps every section's report while the panels are closed.

export type AnySectionReport = SectionReport<unknown>;

/**
 * When a section checks the page:
 * - `background`: unasked, with the background checks, once the page is idle (a few milliseconds of
 *   work at most, and no requests: it runs for every page a reviewer opens);
 * - `panel`: when its panel opens, and on Check again;
 * - `manual`: only when its own control asks (`useSection(...).run`): work that takes long, sends
 *   requests or changes the page while it runs.
 */
export type SectionWhen = 'background' | 'panel' | 'manual';

export type SectionDefinition<Report extends AnySectionReport = AnySectionReport> = {
    /** Unique among all sections; also `data-uier-section` on its card */
    id: string;
    panel: ChecksPanelId;
    when: SectionWhen;
    /** Reads the page with the on-demand checks; nothing when there is nothing to show */
    run(checks: LazyChecks, context: SectionContext): Promise<Report | undefined> | Report | undefined;
    /**
     * What it adds to its panel's indicator. By default its checks worth a look: each `warn` check
     * for the SEO panel ("2 to look at"), each issue of a `warn` check for the Accessibility panel
     * ("3 issues found")
     */
    attention?(report: Report): number;
};

/** Types a section's report from what its `run` returns */
export function defineSection<Report extends AnySectionReport>(definition: SectionDefinition<Report>) {
    return definition;
}

export type SectionState<Report extends AnySectionReport = AnySectionReport> = {
    /**
     * `idle`: not checked (or nothing to show); `checking`; `done`: `report` is this check's;
     * `failed`: the check threw; `unavailable`: no audit asset here (a packaged client without it)
     */
    status: 'idle' | 'checking' | 'done' | 'failed' | 'unavailable';
    /** The last report, kept while checking again */
    report?: Report;
    /** The page the report is of */
    path?: string;
    checkedAt?: number;
};

const idle: SectionState = { status: 'idle' };

type SectionsStore = {
    path: string;
    definitions: readonly SectionDefinition[];
    states: ReadonlyMap<string, SectionState>;
    /** Checks one section now (a newer check of the same section replaces a running one) */
    run: (definition: SectionDefinition) => Promise<void>;
    /** A panel opened: its sections without a report of this page; `again` (Check again): all of them, and `manual` reports are dropped */
    runPanel: (panel: ChecksPanelId, options?: { again?: boolean }) => void;
    /** The `background` sections without a report of this page, one at a time when the browser is idle */
    runBackground: () => void;
    /** Background sections not yet started are not started (the toolbar collapsed) */
    cancelBackground: () => void;
};

/**
 * Every section's state for this page, kept by `PageChecks` (which remounts for every page). One
 * check per section at a time; a failed one says so in the console and in its section.
 */
export function useSectionsStore(path: string, definitions: readonly SectionDefinition[]): SectionsStore {
    const [states, setStates] = useState<ReadonlyMap<string, SectionState>>(() => new Map());
    const pathRef = useRef(path);
    pathRef.current = path;
    // Each section's running check, and the page each one last ran for: read before React renders the states
    const controls = useRef(new Map<string, AbortController>());
    const ranFor = useRef(new Map<string, string>());
    const background = useRef<AbortController>(undefined);
    useEffect(() => () => {
        background.current?.abort();
        for (const control of controls.current.values()) control.abort();
    }, []);

    const run = useCallback((definition: SectionDefinition): Promise<void> => {
        const { id } = definition;
        controls.current.get(id)?.abort();
        const controller = new AbortController();
        controls.current.set(id, controller);
        const checkedPath = pathRef.current;
        ranFor.current.set(id, checkedPath);
        const update = (change: (current: SectionState) => SectionState) =>
            setStates(current => new Map(current).set(id, change(current.get(id) ?? idle)));
        // Only the section's latest check sets its state; one cancelled by leaving the page sets nothing
        const end = (change: (current: SectionState) => SectionState) => {
            if (controls.current.get(id) !== controller) return;
            controls.current.delete(id);
            if (!controller.signal.aborted) update(change);
        };
        if (!auditAvailable()) {
            end(() => ({ status: 'unavailable' }));
            return Promise.resolve();
        }
        update(current => ({ ...current, status: 'checking' }));
        return loadChecks()
            .then(checks => {
                controller.signal.throwIfAborted();
                return definition.run(checks, { path: checkedPath, signal: controller.signal });
            })
            .then(report => end(() => report ? { status: 'done', report, path: checkedPath, checkedAt: Date.now() } : idle), error => {
                if (controller.signal.aborted) return;
                ranFor.current.delete(id);
                console.warn(`uier-toolbar: The ${id} check could not run`, error);
                end(current => ({ ...current, status: 'failed' }));
            });
    }, []);

    const runPanel = useCallback((panel: ChecksPanelId, { again = false }: { again?: boolean } = {}) => {
        for (const definition of definitions) {
            if (definition.panel !== panel) continue;
            if (definition.when === 'manual') {
                // Check again starts over: what a manual check found before may no longer be true
                if (again && ranFor.current.has(definition.id)) {
                    controls.current.get(definition.id)?.abort();
                    controls.current.delete(definition.id);
                    ranFor.current.delete(definition.id);
                    setStates(current => {
                        const next = new Map(current);
                        next.delete(definition.id);
                        return next;
                    });
                }
                continue;
            }
            if (again || ranFor.current.get(definition.id) !== pathRef.current) void run(definition);
        }
    }, [definitions, run]);

    const runBackground = useCallback(() => {
        background.current?.abort();
        const controller = new AbortController();
        background.current = controller;
        void (async () => {
            for (const definition of definitions) {
                if (definition.when !== 'background' || ranFor.current.get(definition.id) === pathRef.current) continue;
                // The page's own tasks go first, and each section is its own task
                await nextIdle(controller.signal);
                if (ranFor.current.get(definition.id) !== pathRef.current) await run(definition);
            }
        })().catch(() => { /* Cancelled: the panel checks the page when it opens. */ });
    }, [definitions, run]);

    const cancelBackground = useCallback(() => background.current?.abort(), []);

    return { path, definitions, states, run, runPanel, runBackground, cancelBackground };
}

export const SectionsContext = createContext<SectionsStore | undefined>(undefined);

/**
 * Whether the review layer shows on the page: not while the toolbar is collapsed. What a section
 * draws over the page (an outline, a tab order) is in the toolbar's shadow root (a portal into
 * `rootElement` of `CommentsBootstrapperContext`, like `ElementHighlight`) and hides with it.
 */
export const PageLayerContext = createContext(true);

export function usePageLayerVisible() {
    return useContext(PageLayerContext);
}

/** A section's state and its check, for its component: `const section = useSection(crawlerSection)` */
export function useSection<Report extends AnySectionReport>(definition: SectionDefinition<Report>): SectionState<Report> & { run: () => void } {
    const store = useContext(SectionsContext);
    const state = (store?.states.get(definition.id) ?? idle) as SectionState<Report>;
    return { ...state, run: () => { void store?.run(definition); } };
}

/** What a report adds to its panel's indicator when its definition does not say */
function defaultAttention(panel: ChecksPanelId, report: AnySectionReport) {
    const warnings = report.checks.filter(check => check.state === 'warn');
    return panel === 'seo' ? warnings.length : warnings.reduce((total, check) => total + Math.max(1, check.issues.length), 0);
}

/** A panel's sections that have a report of this page */
function reported(store: Pick<SectionsStore, 'path' | 'definitions' | 'states'>, panel: ChecksPanelId) {
    return store.definitions.flatMap(definition => {
        const state = store.states.get(definition.id);
        return definition.panel === panel && state?.report && state.path === store.path ? [{ definition, report: state.report }] : [];
    });
}

/** Every check of a panel's sections that have this page's report (the SEO panel's summary counts them) */
export function sectionChecks(store: Pick<SectionsStore, 'path' | 'definitions' | 'states'>, panel: ChecksPanelId): PageCheck[] {
    return reported(store, panel).flatMap(({ report }) => report.checks);
}

/** What a panel's sections found to act on in this page, for its button's dot and name */
export function sectionsAttention(store: Pick<SectionsStore, 'path' | 'definitions' | 'states'>, panel: ChecksPanelId): number {
    return reported(store, panel).reduce((total, { definition, report }) => total + (definition.attention?.(report) ?? defaultAttention(panel, report)), 0);
}

/** The checks of the open panel's sections, for its summary */
export function usePanelSectionChecks(panel: ChecksPanelId): PageCheck[] {
    const store = useContext(SectionsContext);
    return store ? sectionChecks(store, panel) : [];
}

/**
 * A section's card: its checks as compact rows, then its own rows (`children`: `li` elements, or a
 * `CheckItem`). While its first check runs it says so; one that failed says so too (Check again
 * retries); without a report (nothing to show, or no audit asset here) it renders nothing.
 */
export function ReportSection({ id, title, section, note, children }: {
    id: string;
    title: string;
    section: SectionState;
    /** Instead of the report's own note */
    note?: ReactNode;
    children?: ReactNode;
}) {
    const { status, report } = section;
    const t = useMessages();
    if (!report) {
        if (status !== 'checking' && status !== 'failed') return null;
        return (
            <CheckSection title={title} data-uier-section={id} data-uier-section-status={status} aria-busy={status === 'checking' || undefined}>
                {/* Not a live region: the panel has one status, and several sections start at once */}
                <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    {status === 'checking' && <LoaderSpinner size={14} aria-hidden="true" className="motion-safe:animate-spin" />}
                    {status === 'checking' ? t.sections.checkingPage : t.sections.notChecked}
                </li>
            </CheckSection>
        );
    }
    return (
        <CheckSection title={title} count={report.count} note={note ?? report.note} data-uier-section={id} data-uier-section-status={status}>
            {report.checks.map(check => <CheckItem key={check.id} check={check} />)}
            {children}
        </CheckSection>
    );
}
