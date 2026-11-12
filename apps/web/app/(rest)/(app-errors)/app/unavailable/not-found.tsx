import { Suspense } from 'react';
import { connection } from 'next/server';
import { AppNotFound } from '@/src/components/app/AppNotFound';
import { AppLanguage } from '@/src/components/app/AppLanguage';
import { PageLoading } from '@/src/components/app/PageLoading';

export default function UnavailableContent() {
    return <>
        <Suspense fallback={<PageLoading />}><AppLanguage><AppNotFound /></AppLanguage></Suspense>
        <Suspense><RequestScripts /></Suspense>
    </>;
}

// The preflight rewrites denied requests here with HTTP 404. Resume scripts use that request's nonce.
async function RequestScripts() {
    await connection();
    return null;
}
