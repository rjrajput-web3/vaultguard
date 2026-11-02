/**
 * VAULTRY BrandMark — the official transparent V mark inside an elegant
 * circular treatment: subtle purple radial gradient, soft glow, clean 1px
 * edge, V centered with padding. The V artwork itself is never distorted.
 * Pass className="brand-mark-3d brand-mark-hero brand-glow-pulse" for the
 * hero 3D reveal treatment.
 */
export default function BrandMark({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`brand-mark ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
      <img src="/brand/v-mark-transparent.png" alt="" draggable={false} />
    </span>
  );
}
