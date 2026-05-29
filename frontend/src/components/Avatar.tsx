/* Avatar de iniciais.
   kind="cedente" = quadrado verde sólido / branco
   kind="sacado"  = círculo verde-50 / verde-700 */

export interface AvatarProps {
  name: string;
  size?: number;
  kind?: 'cedente' | 'sacado';
}

export function Avatar({ name, size = 34, kind = 'sacado' }: AvatarProps) {
  const initials = name
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const isCedente = kind === 'cedente';
  return (
    <div
      style={{
        width: size, height: size,
        borderRadius: isCedente ? 9 : '50%',
        background: isCedente ? 'var(--green-500)' : 'var(--green-50)',
        color: isCedente ? '#fff' : 'var(--green-700)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: size * 0.36, flex: '0 0 auto', letterSpacing: '.01em',
      }}
    >
      {initials}
    </div>
  );
}
