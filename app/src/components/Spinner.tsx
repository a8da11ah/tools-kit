/**
 * Spinner — minimal animated indicator.
 *
 * Pure CSS (Tailwind animate-spin). Inline by default so it can sit next to
 * text inside a button.
 */

interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

export default function Spinner({ size = 14, className = "", label }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label ?? "Loading"}
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
