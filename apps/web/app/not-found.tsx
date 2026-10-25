import type { Metadata } from 'next';
import { Button } from '@signalco/ui-primitives/Button';
import { KnownPages } from '../src/knownPages';
import { StatusPage } from '../src/components/StatusPage';

export const metadata: Metadata = {
    title: 'Page not found'
};

export default function NotFound() {
    return (
        <StatusPage
            code="404"
            title="This page is not here"
            note="Nothing to review here."
            description="The link may be old or mistyped, or the page has moved."
            actions={(
                <>
                    <Button variant="solid" href={KnownPages.Landing}>Go to the home page</Button>
                    <Button variant="outlined" href={KnownPages.App}>Open the app</Button>
                </>
            )} />
    );
}
