import { reviewUrl } from '@/src/lib/app/projects';
import { CopyBlock } from '../CopyBlock';
import { displayUrl } from './projectLabels';

/** Plain guest links in configured order (main site first), without a member sign-in code. */
export function GuestReviewLinks({ publicId, urls }: { publicId: string; urls: string[] }) {
    return (
        <ul aria-label="Guest links" className="m-0 flex w-full list-none flex-col gap-4 p-0">
            {urls.map(url => (
                <li key={url} className="flex min-w-0 flex-col gap-2">
                    <p className="m-0 break-all font-mono text-[13px]">{displayUrl(url)}</p>
                    <CopyBlock value={reviewUrl(url, publicId)} label={`Copy the guest link for ${displayUrl(url)}`} />
                </li>
            ))}
        </ul>
    );
}
