import { InfoIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/src/components/ui/alert';
import { Badge } from '@/src/components/ui/badge';
import type { ClientPresentation } from '@/src/lib/mcp/oauth/grants';

/** The client's name with an Unverified badge when the app registered itself (its name is unchecked) */
export function ClientName({ client, name = client.name }: { client: ClientPresentation; name?: string }) {
    return (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium break-words">{name}</span>
            {client.kind === 'dcr' && <Badge variant="outline">Unverified</Badge>}
        </span>
    );
}

/**
 * Where a client is published and where it sends people back (docs/mcp-oauth-plan.md §7). The name
 * always comes from the client, so only the hosts are facts uier checked.
 */
export function ClientHosts({ client }: { client: ClientPresentation }) {
    const otherHost = client.kind === 'cimd' && client.redirectHost !== null && client.redirectHost !== client.metadataHost;
    return (
        <>
            {client.kind === 'cimd' && client.metadataHost && <span className="block break-words">Published at <span className="font-mono text-[13px]">{client.metadataHost}</span></span>}
            <span className="block break-words">
                {client.redirectHost === null
                    ? 'Sends you back to this computer'
                    : <>Sends you back to <span className={otherHost ? 'font-mono text-[13px] font-semibold text-foreground' : 'font-mono text-[13px]'}>{client.redirectHost}</span></>}
            </span>
        </>
    );
}

/** What to check before approving: an unverified name, a return to this computer */
export function ClientNotices({ client }: { client: ClientPresentation }) {
    const notices = [
        ...(client.kind === 'dcr' ? ['uier cannot confirm who made this app. Its name was supplied by the app.'] : []),
        ...(client.redirectHost === null ? ['Only continue if you just started this from a coding tool on this computer. Any program on this computer can use this name.'] : []),
        ...(client.kind === 'cimd' && client.redirectHost !== null && client.redirectHost !== client.metadataHost
            ? [`This app sends you back to ${client.redirectHost}, not to ${client.metadataHost}.`] : [])
    ];
    if (!notices.length)
        return null;
    return (
        <Alert role="note">
            <InfoIcon />
            <AlertDescription>
                {notices.map(notice => <p key={notice}>{notice}</p>)}
            </AlertDescription>
        </Alert>
    );
}
