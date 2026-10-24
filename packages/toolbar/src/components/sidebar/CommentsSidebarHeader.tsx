import { Row } from '@signalco/ui-primitives/Row';
import { IconButton } from '@signalco/ui-primitives/IconButton';
import { Button } from '@signalco/ui-primitives/Button';
import { Typography } from '@signalco/ui-primitives/Typography';
import { cx } from '@signalco/ui-primitives/cx';
import { Filter, PanelRightClose } from '@signalco/ui-icons';
import { CommentsFilter } from './CommentsFilter';

type CommentsSidebarHeaderProps = {
    filterOpen: boolean;
    status: NonNullable<CommentsFilter['status']>;
    onStatusChange: (status: NonNullable<CommentsFilter['status']>) => void;
    onClose: () => void;
    onToggleFilter: () => void;
};

const statuses = [
    { value: 'unresolved', label: 'Open' },
    { value: 'resolved', label: 'Done' }
] as const;

export function CommentsSidebarHeader({ filterOpen, status, onStatusChange, onClose, onToggleFilter }: CommentsSidebarHeaderProps) {
    return (
        <Row justifyContent="space-between">
            <Row spacing={1}>
                <Typography component="h2" level="body1" semiBold className="text-foreground">Comments</Typography>
                <Row role="group" aria-label="Show comments" className="rounded-md bg-muted p-0.5">
                    {statuses.map((s) => (
                        <Button
                            key={s.value}
                            size="xs"
                            variant="plain"
                            aria-pressed={status === s.value}
                            className={cx(
                                'rounded-sm',
                                status === s.value ? 'bg-accent text-foreground' : 'text-muted-foreground'
                            )}
                            onClick={() => onStatusChange(s.value)}>
                            {s.label}
                        </Button>
                    ))}
                </Row>
            </Row>
            <Row>
                {/* TODO Enable when implemented */}
                {/* <IconButton variant={filterOpen ? 'soft' : 'plain'} onClick={onToggleFilter} title="Toggle filter">
                    <Filter size={16} />
                </IconButton> */}
                <IconButton onClick={onClose} variant="plain" title="Close sidebar" aria-label="Close sidebar" autoFocus>
                    <PanelRightClose />
                </IconButton>
            </Row>
        </Row>
    );
}
