import { useContext } from 'react';
import { newLocalId, useComments } from '../../hooks/useComments';
import { anchorSelector } from '../../anchorSelector';
import { withLayer } from '../../layerAnchor';
import { captureCommentScreenshot } from '../../screenshot';
import { defaultFeedbackTypes, type CommentKind, type FeedbackTypeSnapshot } from '../../feedbackTypes';
import { useProjectViewer } from '../../project/ProjectGate';
import { pageAnchorElement } from '../../checks/pageElements';
import type { PageIssue } from '../../checks/types';
import { CommentsBootstrapperContext } from '../CommentsBootstrapperContext';
import { getDeviceInfo } from '../info/getDeviceInfo';
import type { CommentItem, CommentItemPosition, CommentPoint } from '../@types/Comments';
import { messages } from '../../i18n';
import { feedbackTypeText } from '../../i18n/format';

/** A point in the middle of the element, as the keyboard path pins comments */
function centerPoint(element: Element): CommentPoint {
    return { type: 'point', selector: anchorSelector(element), xNormal: 0.5, yNormal: 0.5 };
}

export type IssueCommentResult = { comment: CommentItem; page: boolean; label: string };

/**
 * A panel's quick action: one click posts the issue as a new comment, through the same create as
 * the new-comment form (its pin at once, the screenshot and the browser's details). An issue with
 * an element is pinned to it (scrolled into view for the screenshot); one about the page is the
 * project's page feedback (a bug report where it is on), else pinned to the main content.
 */
export function useIssueComment() {
    const { rootElement } = useContext(CommentsBootstrapperContext);
    const { create } = useComments();
    const { feedbackTypes = defaultFeedbackTypes } = useProjectViewer();
    return async (issue: PageIssue): Promise<IssueCommentResult> => {
        const t = messages();
        const element = pageAnchorElement(issue.element);
        const enabled = feedbackTypes.filter(type => type.enabled);
        const pageType = element ? undefined : enabled.find(type => type.id === 'bug') ?? enabled.find(type => type.id === 'feedback') ?? enabled[0];
        let position: CommentItemPosition;
        let kind: CommentKind | undefined;
        let feedbackType: FeedbackTypeSnapshot | undefined;
        if (pageType) {
            position = { type: 'page' };
            kind = pageType.id;
            if (pageType.id.startsWith('custom_')) feedbackType = { id: pageType.id, label: pageType.label, icon: pageType.icon };
        } else {
            const target = element ?? document.querySelector('main') ?? document.body;
            // In the window for the screenshot, which copies the part of the page around the pin
            target.scrollIntoView({ block: 'center', behavior: 'instant' });
            position = withLayer(centerPoint(target), target);
        }
        const comment = await create.mutateAsync({
            localId: newLocalId(),
            position,
            kind,
            feedbackType,
            text: issue.comment,
            check: issue.check,
            device: getDeviceInfo(),
            screenshot: captureCommentScreenshot(position, rootElement)
        });
        return { comment, page: position.type === 'page', label: pageType ? t.feedback.typeSent(feedbackTypeText(pageType, t).label) : t.pin.commentPosted };
    };
}
