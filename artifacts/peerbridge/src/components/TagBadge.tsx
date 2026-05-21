interface TagBadgeProps {
  name: string;
  color?: string;
}

export function TagBadge({ name, color = "#6366f1" }: TagBadgeProps) {
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);

  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.12)`,
        color: color,
        border: `1px solid rgba(${r}, ${g}, ${b}, 0.25)`,
      }}
    >
      {name}
    </span>
  );
}
