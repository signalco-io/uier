import { BookmarkIcon, BugIcon, HeartIcon, InfoIcon, MessageCircleIcon, RocketIcon, SparklesIcon, ZapIcon } from 'lucide-react';
import type { FeedbackTypeIcon as IconName } from '@uier/toolbar/feedback-types';

const icons = { heart: HeartIcon, bug: BugIcon, message: MessageCircleIcon, sparkles: SparklesIcon, rocket: RocketIcon, bookmark: BookmarkIcon, info: InfoIcon, lightning: ZapIcon };
export function FeedbackTypeIcon({ icon, ...props }: { icon: IconName } & React.ComponentProps<typeof HeartIcon>) {
    const Icon = icons[icon];
    return <Icon aria-hidden="true" {...props} />;
}
