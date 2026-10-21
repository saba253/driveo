import Image from "next/image";
import { brand } from "@/config/brand";
import { ka } from "@/content/ka";

/**
 * Cinematic hero backdrop. Renders the configured photograph when
 * `brand.heroImage` is set; otherwise a self-contained SVG night-road
 * treatment. Both share the same overlays so text contrast is preserved.
 */
export function HeroVisual() {
  const image = brand.heroImage;

  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden={image ? undefined : true}>
      {image ? (
        <Image
          src={image.src}
          width={image.width}
          height={image.height}
          alt={ka.hero.imageAlt}
          sizes="100vw"
          preload
          className="absolute inset-0 size-full object-cover object-[70%_center]"
        />
      ) : (
        <NightRoad />
      )}

      {/* Legibility: darken behind the headline (left on desktop, top on mobile). */}
      <div className="absolute inset-0 bg-linear-to-b from-canvas/85 via-canvas/45 to-canvas/10 lg:bg-[linear-gradient(90deg,var(--color-canvas)_0%,rgb(16_19_24/0.7)_32%,transparent_58%)]" />
      {/* Vignette and blend into the page below. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_60%_40%,transparent_40%,var(--color-canvas)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-canvas" />
      <div className="absolute inset-0 bg-grain opacity-[0.07] mix-blend-overlay" />
    </div>
  );
}

/* Abstract road at night: lit horizon, converging edges, moving lane marks. */
function NightRoad() {
  const vx = 800; // vanishing point x — centred, so it sits between copy and card on desktop
  const hy = 610; // horizon y

  return (
    <svg
      className="absolute inset-0 size-full animate-fade"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
    >
      <defs>
        <radialGradient id="hv-glow" cx={vx} cy={hy} r="720" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#D9F66F" stopOpacity="0.28" />
          <stop offset="0.35" stopColor="#D9F66F" stopOpacity="0.07" />
          <stop offset="1" stopColor="#D9F66F" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hv-haze" cx={vx} cy={hy} r="520" gradientUnits="userSpaceOnUse" gradientTransform={`translate(${vx} ${hy}) scale(1 0.18) translate(${-vx} ${-hy})`}>
          <stop offset="0" stopColor="#F6F7F8" stopOpacity="0.22" />
          <stop offset="1" stopColor="#F6F7F8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hv-sky" x1="0" y1="0" x2="0" y2={hy} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#101318" />
          <stop offset="1" stopColor="#1C222B" />
        </linearGradient>
        <linearGradient id="hv-ground" x1="0" y1={hy} x2="0" y2="1000" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#151A21" />
          <stop offset="1" stopColor="#0B0D11" />
        </linearGradient>
        <linearGradient id="hv-road" x1="0" y1={hy} x2="0" y2="1000" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2B323C" stopOpacity="0.2" />
          <stop offset="1" stopColor="#2B323C" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id="hv-edge" x1="0" y1={hy} x2="0" y2="1000" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F6F7F8" stopOpacity="0" />
          <stop offset="1" stopColor="#F6F7F8" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="hv-lane" x1="0" y1={hy} x2="0" y2="1000" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#D9F66F" stopOpacity="0" />
          <stop offset="1" stopColor="#D9F66F" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="hv-horizon" x1="0" y1="0" x2="1600" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F6F7F8" stopOpacity="0" />
          <stop offset={vx / 1600} stopColor="#F6F7F8" stopOpacity="0.35" />
          <stop offset="1" stopColor="#F6F7F8" stopOpacity="0" />
        </linearGradient>
        <filter id="hv-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <rect width="1600" height={hy} fill="url(#hv-sky)" />
      <rect y={hy} width="1600" height={1000 - hy} fill="url(#hv-ground)" />
      <rect width="1600" height="1000" fill="url(#hv-glow)" />

      {/* Road surface and edges */}
      <polygon points={`${vx - 14},${hy} ${vx + 14},${hy} 1760,1000 120,1000`} fill="url(#hv-road)" />
      <line x1={vx - 14} y1={hy} x2="120" y2="1000" stroke="url(#hv-edge)" strokeWidth="2" />
      <line x1={vx + 14} y1={hy} x2="1760" y2="1000" stroke="url(#hv-edge)" strokeWidth="2" />

      {/* Moving centre lane */}
      <line
        className="animate-lane"
        x1={vx}
        y1={hy}
        x2={vx}
        y2="1000"
        stroke="url(#hv-lane)"
        strokeWidth="4"
        strokeDasharray="36 60"
      />

      {/* Horizon haze, line and distant lights */}
      <rect width="1600" height="1000" fill="url(#hv-haze)" />
      <line x1="0" y1={hy} x2="1600" y2={hy} stroke="url(#hv-horizon)" strokeWidth="1" />
      <g filter="url(#hv-blur)">
        <circle cx={vx - 4} cy={hy - 2} r="4" fill="#F6F7F8" opacity="0.9" />
        <circle cx={vx + 6} cy={hy - 2} r="4" fill="#F6F7F8" opacity="0.9" />
        <circle cx={vx - 210} cy={hy - 4} r="2.5" fill="#D9F66F" opacity="0.5" />
        <circle cx={vx + 260} cy={hy - 6} r="2" fill="#F6F7F8" opacity="0.35" />
        <circle cx={vx + 420} cy={hy - 3} r="2.5" fill="#D9F66F" opacity="0.3" />
        <circle cx={vx - 430} cy={hy - 5} r="2" fill="#F6F7F8" opacity="0.25" />
      </g>
    </svg>
  );
}
