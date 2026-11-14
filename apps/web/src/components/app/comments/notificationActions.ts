'use client';

import { updateNotificationAction as update } from './serverNotificationActions';
import { refreshCommentsAfter } from './commentRefresh';

export const updateNotificationAction = refreshCommentsAfter(update);
