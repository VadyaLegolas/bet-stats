/**
 * Football-ball brand mark for the site header ("Matchday Programme" design system).
 * Decorative only — the surrounding link text carries the accessible name.
 */
export function BrandIcon({ size = 24 }: { size?: number }) {
  return (
    <svg className="brand-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.2 16.57 10.52 14.82 15.88 9.18 15.88 7.43 10.52Z" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2.6V7.2" />
        <path d="M16.57 10.52 20.94 9.09" />
        <path d="M14.82 15.88 17.53 19.6" />
        <path d="M9.18 15.88 6.47 19.6" />
        <path d="M7.43 10.52 3.06 9.09" />
      </g>
    </svg>
  );
}
