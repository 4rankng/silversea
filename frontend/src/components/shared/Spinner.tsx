export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <div
      className="spin"
      style={{
        width: size,
        height: size,
        border: `${Math.max(2, size / 8)}px solid var(--border-2)`,
        borderTopColor: 'var(--brand)',
        borderRadius: '50%',
      }}
    />
  );
}
