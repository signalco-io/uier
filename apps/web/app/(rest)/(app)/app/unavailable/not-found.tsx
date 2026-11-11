import { Suspense } from 'react';
import { connection } from 'next/server';
import NotFound from '../../../../not-found';

export default function UnavailableContent() {
    return <><NotFound /><Suspense><RequestScripts /></Suspense></>;
}

// The preflight rewrites denied requests here with HTTP 404. Resume scripts use that request's nonce.
async function RequestScripts() {
    await connection();
    return null;
}
