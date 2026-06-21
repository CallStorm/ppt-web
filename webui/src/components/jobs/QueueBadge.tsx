export function QueueBadge({ position }: { position: number | null | undefined }) {
  if (position == null) return null
  return <span className="queue-badge">#{position}</span>
}
