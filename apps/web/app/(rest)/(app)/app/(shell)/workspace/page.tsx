import { redirect } from 'next/navigation';
import { requireAppContext } from '@/src/lib/app/context';
import { workspaceTabs } from '@/src/components/app/workspace/workspaceTabs';

/** `/app/workspace`: the area's first tab the person has (Users for admins, otherwise Clients) */
export default async function WorkspacePage() {
    const [first] = workspaceTabs(await requireAppContext());
    redirect(first!.href);
}
