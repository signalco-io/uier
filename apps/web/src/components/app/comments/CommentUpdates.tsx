'use client';

import { createContext, useContext } from 'react';
import type { ProjectCommentView } from '../../../lib/app/projectComments';

export type CommentUpdate = { id: string; patch: Partial<ProjectCommentView> } | { id: string; readSequence: number };
const CommentUpdates = createContext<(update: CommentUpdate) => void>(() => {});

/** Optimistic changes belong to the whole list, so filters, counts and board columns agree. */
export const CommentUpdatesProvider = CommentUpdates.Provider;
export function useCommentUpdate() { return useContext(CommentUpdates); }
