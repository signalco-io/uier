import { Stack } from '@signalco/ui-primitives/Stack';
import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { PanelRightClose } from '@signalco/ui-icons';
import { CommentsStatusFilter } from './CommentsFilter';

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
                <Typography component="h2" level="body1" semiBold className="text-foreground">Comments</Typography>
                <IconButton onClick={onClose} variant="plain" title="Close sidebar" aria-label="Close sidebar" autoFocus>
                    <PanelRightClose />
                </IconButton>
            </Row>
            <Row role="group" aria-label="Show comments" className="self-start rounded-md bg-muted p-0.5">
                {statuses.map((s) => (
                    <Button key={s.value} size="xs" variant="plain" aria-pressed={status === s.value}
                        className={cx('rounded-sm pointer-coarse:h-11 pointer-coarse:min-w-11',
                            status === s.value ? 'bg-accent text-foreground' : 'text-muted-foreground')}
                        onClick={() => onStatusChange(s.value)}>
                        {s.label} <span className="tabular-nums">{counts[s.value]}</span>
                    </Button>
                ))}
            </Row>
        </Stack>
    );
}
