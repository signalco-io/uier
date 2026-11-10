import { useId, useState } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { cx } from '@signalco/ui-primitives/cx';
import { Copy, Down, LoaderSpinner } from '@signalco/ui-icons';
import { runtimeAdapters } from '../../../adapters';
import { toolbarConfig } from '../../../config';
import type { AiSearchDetails } from '../../../checks/lazy/aiSearch';
import { pageIssue } from '../../../checks/lazy/api';
import { foundLine } from '../../../checks/pageElements';
import type { PageIssue } from '../../../checks/types';
import { apiRequest, CommentsApiError, required } from '../../../hooks/api';
import { useAnnounce } from '../../Announcer';
import { getCommentsErrorMessage, retryAfterText, UsageLink } from '../../CommentsErrorMessage';
import { IconTooltip } from '../../IconTooltip';
import { destructiveTextClassName } from '../../@types/Comments';
import { CheckItem, CheckSection, IssueActions } from '../ChecksParts';
import { defineSection, ReportSection, useSection, type SectionDefinition } from './sections';

// The SEO panel's AI search section (packages/toolbar/docs/page-checks-ai-search.md): what an AI reads
// of the page (its main content as Markdown, with Copy), its citable facts, and AI suggestions that send
// the page's main text to uier only when a button is pressed (src/checks/lazy/aiSearch.ts reads the page).

export const aiSearchSection = defineSection({ id: 'aiSearch', panel: 'seo', when: 'panel', run: (checks, context) => checks.aiSearch.readPage(context) });

/** Every section of this area, for `PageChecks` (their reports, the background checks, the panel's indicator) */
export const aiSearchSections: readonly SectionDefinition[] = [aiSearchSection];

/** The rows of what an AI reads; the others are the citable facts */
const contentChecks = ['ai-content', 'ai-text', 'ai-left-out'];

export function AiSearchSection() {
    const section = useSection(aiSearchSection);
    const { report, path = '' } = section;
    const details = report?.details;
    return <>
        <ReportSection id={aiSearchSection.id} title="AI search" note="As rendered in this browser"
            section={{ ...section, report: report && { ...report, checks: report.checks.filter(check => contentChecks.includes(check.id)) } }}>
            {details && <MarkdownPreview markdown={details.markdown} />}
            {/* Packaged clients talk to uier through a closed route contract without this route */}
            {details?.markdown.trim() && !runtimeAdapters() && <PageSuggestions details={details} path={path} />}
        </ReportSection>
        {report && (
            <CheckSection title="Citable facts" data-uier-section="aiSearch-facts">
                {report.checks.filter(check => !contentChecks.includes(check.id)).map(check => <CheckItem key={check.id} check={check} />)}
            </CheckSection>
        )}
    </>;
}

/** Copies text, and says so; where the browser does not allow it, the text stays on screen to select */
function useCopy(done: string) {
    const announce = useAnnounce();
    const [failed, setFailed] = useState(false);
    const copy = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setFailed(false);
            announce(done);
            return true;
        } catch {
            setFailed(true);
            return false;
        }
    };
    return { copy, failed: failed && <p role="alert" className="m-0 text-xs text-muted-foreground">Couldn&rsquo;t copy. Select the text and copy it instead.</p> };
}

const quietButton = 'text-muted-foreground hover:text-foreground pointer-coarse:min-h-11';

/** The main content as Markdown: folded, scrollable and selectable, with Copy as Markdown */
function MarkdownPreview({ markdown }: { markdown: string }) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const { copy, failed } = useCopy('Markdown copied');
    return (
        <li className="flex min-w-0 flex-col gap-1.5 px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
                <Button size="xs" variant="plain" aria-expanded={open} aria-controls={id} className={cx('-ml-1', quietButton)}
                    startDecorator={<Down size={16} aria-hidden="true" className={open ? undefined : '-rotate-90'} />}
                    onClick={() => setOpen(current => !current)}>
                    Markdown
                </Button>
                <Button size="xs" variant="plain" className={quietButton} startDecorator={<Copy size={14} aria-hidden="true" />}
                    onClick={async () => { if (!await copy(markdown)) setOpen(true); }}>
                    Copy as Markdown
                </Button>
            </div>
            {failed}
            <div id={id} hidden={!open}>
                {open && (
                    <textarea readOnly value={markdown} spellCheck={false} aria-label="Main content as Markdown"
                        className="block h-56 w-full resize-none rounded-lg border bg-background p-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                )}
            </div>
        </li>
    );
}

type SuggestionKind = 'title' | 'description' | 'questions';

/** Each kind's button and list; a title and a description can become a comment naming their SEO check */
const kinds: { kind: SuggestionKind; button: string; list: string }[] = [
    { kind: 'title', button: 'Suggest a title', list: 'Suggested titles' },
    { kind: 'description', button: 'Suggest a meta description', list: 'Suggested meta descriptions' },
    { kind: 'questions', button: 'Questions this page answers', list: 'Questions this page answers' }
];

const suggestionsUrl = toolbarConfig.project
    ? `${toolbarConfig.apiUrl}/api/review/${toolbarConfig.project}/page-suggestions`
    : `${toolbarConfig.apiUrl}/api/page-suggestions`;

/** Suggestions of this page while the panel is closed (in memory only): each one was a paid request */
const kept = new Map<string, string[]>();

type SuggestionsState = { pending?: boolean; suggestions?: string[]; error?: unknown };

function useSuggestions(kind: SuggestionKind, details: AiSearchDetails, path: string) {
    const announce = useAnnounce();
    const key = `${path}\n${kind}`;
    const [state, setState] = useState<SuggestionsState>(() => ({ suggestions: kept.get(key) }));
    const ask = async () => {
        if (state.pending) return;
        setState(current => ({ ...current, pending: true, error: undefined }));
        try {
            // The first characters of the main text (what the API accepts), the title and the description
            const result = required(await apiRequest<{ suggestions?: unknown }>(suggestionsUrl, {
                method: 'POST',
                body: {
                    kind,
                    text: details.markdown.slice(0, 4000).replace(/[\ud800-\udbff]$/, ''),
                    title: details.title.slice(0, 200) || undefined,
                    description: details.description.slice(0, 500) || undefined
                }
            }));
            // Plain text only (the API bounds each one)
            const suggestions = Array.isArray(result.suggestions) ? result.suggestions.filter((item): item is string => typeof item === 'string').slice(0, 3) : [];
            kept.set(key, suggestions);
            setState({ suggestions });
            announce(suggestions.length ? `${suggestions.length} ${suggestions.length === 1 ? 'suggestion' : 'suggestions'}` : 'No suggestions for this page');
        } catch (error) {
            setState(current => ({ ...current, pending: false, error }));
        }
    };
    return { state, ask };
}

/**
 * AI suggestions for the page: a title, a meta description and the questions it answers. Nothing is
 * sent until a button is pressed; then the page's main text (its first characters), title and
 * description go to uier's API. Suggestions are plain text, with Copy and, for the title and the
 * description, Comment (about the page, naming the SEO check).
 */
function PageSuggestions({ details, path }: { details: AiSearchDetails; path: string }) {
    const lists = [useSuggestions('title', details, path), useSuggestions('description', details, path), useSuggestions('questions', details, path)];
    const noteId = useId();
    return (
        <li className="flex min-w-0 flex-col gap-2 px-3 py-2" data-uier-ai-suggestions="">
            <div role="group" aria-label="AI suggestions" className="flex flex-wrap gap-1">
                {kinds.map((kind, index) => (
                    // Busy, not disabled, so the focus stays on the button while it asks
                    <Button key={kind.kind} size="xs" variant="outlined" aria-describedby={noteId} className="pointer-coarse:min-h-11"
                        aria-disabled={lists[index]!.state.pending} aria-busy={lists[index]!.state.pending}
                        startDecorator={lists[index]!.state.pending && <LoaderSpinner size={14} aria-hidden="true" className="motion-safe:animate-spin" />}
                        onClick={() => void lists[index]!.ask()}>
                        {kind.button}
                    </Button>
                ))}
            </div>
            <p id={noteId} className="m-0 text-xs text-muted-foreground">Sends this page&rsquo;s main text to uier.</p>
            {kinds.map((kind, index) => <SuggestionList key={kind.kind} {...kind} state={lists[index]!.state} details={details} path={path} />)}
        </li>
    );
}

function SuggestionList({ kind, list, state, details, path }: (typeof kinds)[number] & { state: SuggestionsState; details: AiSearchDetails; path: string }) {
    const { copy, failed } = useCopy('Copied');
    const { error, suggestions } = state;
    if (error) {
        const limited = error instanceof CommentsApiError && error.code === 'rate_limited';
        return (
            <p role="alert" className={cx('m-0 text-sm', destructiveTextClassName)}>
                {limited ? `No more suggestions for now. Try again ${retryAfterText(error.retryAfter)}.` : getCommentsErrorMessage(error)}
                <UsageLink error={error} />
            </p>
        );
    }
    if (!suggestions) return null;
    if (!suggestions.length) return <p className="m-0 text-sm text-muted-foreground">No {list.toLowerCase()} for this page.</p>;
    // A comment about the page from the title or description check: like that check's issue, one open
    // thread per page (the panel then says "Reported as #12" with Show, here and on the check's row)
    const noun = kind === 'title' ? 'title' : 'description';
    const issueOf = (text: string): PageIssue | undefined => kind === 'questions' ? undefined : {
        ...pageIssue(path, { type: 'seo', id: kind }, undefined, `Suggested ${noun}`,
            `SEO: Suggested ${kind === 'title' ? 'title' : 'meta description'} for this page, from AI suggestions.${foundLine(`Suggested ${noun}`, text)}${foundLine(`Current ${noun}`, details[noun])}`),
        key: `seo:${kind}:suggestion:${text}@${path}`
    };
    return <>
        <ul aria-label={list} className="m-0 flex list-none flex-col gap-1 p-0">
            {suggestions.map(text => <SuggestionItem key={text} text={text} issue={issueOf(text)} onCopy={() => void copy(text)} />)}
        </ul>
        {failed}
    </>;
}

function SuggestionItem({ text, issue, onCopy }: { text: string; issue?: PageIssue; onCopy: () => void }) {
    const id = useId();
    return (
        <li className="flex min-w-0 flex-wrap items-center gap-x-2 rounded-lg bg-muted py-1 pl-2.5 pr-1">
            {/* Plain text: what the model wrote is never read as markup */}
            <p id={id} className="m-0 min-w-0 flex-1 basis-40 select-text break-words py-1 text-sm text-foreground">{text}</p>
            <div className="ml-auto flex items-center gap-0.5">
                <IconTooltip label="Copy">
                    <IconButton size="xs" variant="plain" aria-label="Copy" aria-describedby={id} className="text-muted-foreground hover:text-foreground pointer-coarse:size-11" onClick={onCopy}>
                        <Copy size={14} aria-hidden="true" />
                    </IconButton>
                </IconTooltip>
                {issue && <IssueActions issue={issue} describedBy={id} />}
            </div>
        </li>
    );
}
