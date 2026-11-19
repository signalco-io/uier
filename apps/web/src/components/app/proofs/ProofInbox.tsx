import Link from 'next/link';
import { getAppI18n } from '@/src/lib/i18n/server';
import type { loadProofInbox } from '@/src/lib/proofs/threadInbox';

type Inbox = Awaited<ReturnType<typeof loadProofInbox>>;

export async function ProofInbox({ inbox }: { inbox: Inbox }) {
    const { t } = await getAppI18n();
    const groups = [
        { title: t('Changes ready for you to check ({count})', { count: inbox.count }), items: inbox.checks },
        { title: t('File feedback'), items: inbox.activity }
    ].filter(group => group.items.length > 0);
    return groups.map(group => <section key={group.title} aria-label={group.title} className="mb-4 flex flex-col gap-2">
        <h2 className="text-base font-semibold">{group.title}</h2>
        <ul className="divide-y rounded-xl border">
            {group.items.map(item => <li key={item.id}>
                <Link href={item.href} className="flex min-h-11 min-w-0 flex-col justify-center gap-1 px-3 py-2 text-sm hover:bg-muted">
                    <span className="truncate font-medium">{item.number && <span className="tabular-nums">#{item.number} </span>}{item.text ?? t('Deleted feedback')}</span>
                    <span className="truncate text-xs text-muted-foreground">{item.projectName} · {item.assetName}</span>
                </Link>
            </li>)}
        </ul>
    </section>);
}
