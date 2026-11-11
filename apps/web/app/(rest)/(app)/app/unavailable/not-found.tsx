import { Suspense } from 'react';
import { connection } from 'next/server';
import { AppNotFound } from '@/src/components/app/AppNotFound';

export default function UnavailableContent() {
    return <><AppNotFound /><Suspense><RequestScripts /></Suspense></>;
}

// The preflight rewrites denied requests here with HTTP 404. Resume scripts use that request's nonce.
async function RequestScripts() {
    await connection();
    return null;
}
