'use client';

import { createContext, useContext } from 'react';

const CommitSearch = createContext<() => void>(() => {});
/** Server-authorized author navigation must include search still inside its debounce window. */
export const CommentsSearchNavigationProvider = CommitSearch.Provider;
export function useCommitCommentsSearch() { return useContext(CommitSearch); }
