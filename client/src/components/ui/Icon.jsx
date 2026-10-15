export function Icon({ name, className = "", size = 18, filled = false }) {
  return (
    <span
      className={`material-symbols-outlined normal-case tracking-normal font-normal ${className}`}
      style={{
        fontFamily: "Material Symbols Outlined",
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 20`,
        fontFeatureSettings: "'liga'",
      }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
