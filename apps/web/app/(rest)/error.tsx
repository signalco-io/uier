'use client';

import { useEffect } from 'react';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPages } from '../../src/knownPages';
import { StatusPage } from '../../src/components/StatusPage';

type RootErrorProps = {
    error: Error & { digest?: string };
    reset: () => void;
};

export default function RootError({ error, reset }: RootErrorProps) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error(error);
    }, [error]);

    return (
        <StatusPage
            code={error.digest ? `Error ${error.digest}` : 'Error'}
            title="Something went wrong"
            note="This part did not load."
            description="The page could not load. Try again, or start from the home page."
            actions={(
                <>
                    <Button variant="solid" onClick={() => reset()}>Try again</Button>
                    <Button variant="outlined" href={KnownPages.Landing}>Go to the home page</Button>
                </>
            )} />
    );
}
