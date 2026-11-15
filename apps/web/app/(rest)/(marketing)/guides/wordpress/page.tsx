import { PlatformInstallGuide } from '@/src/components/marketing/guides/PlatformInstallGuide';
import { guides } from '@/src/lib/guides';
import { publicPageMetadata } from '@/src/lib/metadata';

export const metadata = publicPageMetadata(guides.wordpress.path, guides.wordpress);

export default function Page() { return <PlatformInstallGuide platform="wordpress" />; }
