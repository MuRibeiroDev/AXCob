import { STATUS } from '@/lib/aging';
import type { StatusKey } from '@/lib/types';

export function Chip({ status }: { status: StatusKey }) {
  const s = STATUS[status];
  return (
    <span className={'chip ' + s.cls}>
      <span className="dot" />
      {s.label}
    </span>
  );
}
