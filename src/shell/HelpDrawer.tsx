import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { articlesFor, searchGuide } from '../help/guide';
import { Drawer, Input } from '../ui/kit';

export function HelpDrawer({ open, onClose, path }: { open: boolean; onClose: () => void; path: string }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    if (q.trim()) return searchGuide(q);
    const here = articlesFor(path);
    const rest = searchGuide('').filter((a) => !here.includes(a));
    return [...here, ...rest];
  }, [q, path]);
  return (
    <Drawer open={open} onClose={onClose} title="Help & user guide" width="max-w-lg">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
        <Input autoFocus className="pl-8" placeholder="Search the guide (e.g. GSTR-1, credit note, backup)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {list.length === 0 && <p className="text-sm text-slate-500">No help topics match "{q}".</p>}
      <div className="space-y-3">
        {list.map((a, i) => (
          <details key={a.id} open={i === 0} className="rounded-md border border-slate-200 bg-white">
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-800">{a.title}</summary>
            <div className="space-y-2 px-3 pb-3 text-sm text-slate-700">
              {a.body.map((p, j) => (
                <p key={j}>{p}</p>
              ))}
            </div>
          </details>
        ))}
      </div>
    </Drawer>
  );
}
