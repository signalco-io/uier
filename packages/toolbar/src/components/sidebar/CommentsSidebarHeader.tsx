import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { PanelRightClose } from '@signalco/ui-icons';
import { CommentsStatusFilter } from './CommentsFilter';
import { PanelHandle } from '../DockablePanel';

type CommentsSidebarHeaderProps = {
    status: CommentsStatusFilter;
    counts: Record<CommentsStatusFilter, number>;
    onStatusChange: (status: CommentsStatusFilter) => void;
    onClose: () => void;
};

const statuses = [
    { value: 'unresolved', label: 'Open' },
    { value: 'resolved', label: 'Done' },
    { value: 'all', label: 'All' }
] as const;

export function CommentsSidebarHeader({ status, counts, onStatusChange, onClose }: CommentsSidebarHeaderProps) {
    return (
        <Stack spacing={1}>
            <Row justifyContent="space-between">
                <Row spacing={0.5} className="min-w-0">
                    <PanelHandle />
                    <Typography component="h2" level="body1" semiBold className="text-foreground">Comments</Typography>
                </Row>
                <IconButton onClick={onClose} variant="plain" title="Close sidebar" aria-label="Close sidebar" autoFocus>
                    <PanelRightClose />
                </IconButton>
            </Row>
            {/* Underlined tabs, like the app's (shadcn's line tabs) */}
            <Row role="group" aria-label="Show comments" spacing={2} className="border-b">
                {statuses.map((s) => (
                    <Button key={s.value} size="sm" variant="plain" aria-pressed={status === s.value}
                        className={cx('-mb-px gap-1.5 rounded-none border-b-2 px-0.5 hover:bg-transparent active:bg-transparent pointer-coarse:h-11 pointer-coarse:min-w-11',
                            status === s.value ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                        onClick={() => onStatusChange(s.value)}>
                        {s.label} <span className="font-normal tabular-nums text-muted-foreground">{counts[s.value]}</span>
                    </Button>
                ))}
            </Row>
        </Stack>
    );
}
