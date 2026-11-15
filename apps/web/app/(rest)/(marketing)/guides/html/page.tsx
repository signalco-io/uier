import { PlatformInstallGuide } from '@/src/components/marketing/guides/PlatformInstallGuide';
import { guides } from '@/src/lib/guides';
import { publicPageMetadata } from '@/src/lib/metadata';

export const metadata = publicPageMetadata(guides.html.path, guides.html);

export default function Page() { return <PlatformInstallGuide platform="html" />; }
