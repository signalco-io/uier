import type { DbDeviceSize } from '../../../lib/db/schema';

export const deviceLabels: Record<DbDeviceSize, string> = {
    desktop: 'Desktop',
    tablet: 'Tablet',
    mobile: 'Mobile'
};

export type PeopleFilter = 'all' | 'assigned' | 'mine';
export type CommentsView = 'list' | 'board';

export const peopleFilterLabels: Record<PeopleFilter, string> = {
    all: 'All',
    assigned: 'Assigned to me',
    mine: 'Opened by me'
};
