/* eslint-disable @next/next/no-img-element */
/**
 * Football-ball brand mark for the site header ("Matchday Programme" design system).
 * Uses the exact ball from the favicon image, but with the square background removed.
 * Decorative only — the surrounding link text carries the accessible name.
 */
export function BrandIcon({ size = 50 }: { size?: number }) {
  return (
    <img
      className="brand-icon"
      src="/header-ball.png"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      draggable="false"
    />
  );
}
