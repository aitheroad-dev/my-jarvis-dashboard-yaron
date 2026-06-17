import { tagDef } from "../lib/taxonomy";

interface TagPillProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  size?: "sm" | "md";
}

export function TagPill({ label, active, onClick, size = "md" }: TagPillProps) {
  const def = tagDef(label);
  const color = def?.color ?? "#8B5E3C";
  const interactive = !!onClick;
  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`inline-flex items-center gap-1 rounded-full font-medium transition ${pad} ${
        interactive ? "cursor-pointer" : "cursor-default"
      }`}
      style={
        active
          ? { background: color, color: "#fff", border: `1px solid ${color}` }
          : {
              background: interactive ? "#fbf8ef" : "rgba(255,255,255,0.65)",
              color,
              border: `1px solid ${color}55`,
            }
      }
    >
      <span aria-hidden>{def?.emoji}</span>
      {label}
    </button>
  );
}
