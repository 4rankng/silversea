export function Spinner({ size = 20 }: { size?: number }) {
  // Purely visual — the hosting surface owns the accessible loading pattern
  // (role="status" + visible text, see LoadingOverlay). Marking the spinner
  // itself hidden avoids duplicate screen-reader announcements.
  return (
    <div
      aria-hidden="true"
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
