import { agingClass } from '@/lib/aging';

export function AgePill({ dias }: { dias: number }) {
  const cls = agingClass(dias);
  return (
    <span className={'age ' + cls}>
      {dias}
      <span className="u">d</span>
    </span>
  );
}
