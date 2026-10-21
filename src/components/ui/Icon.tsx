import type { SVGProps } from "react";

/* Minimal inline stroke icons (24px grid). Decorative by default. */
const paths = {
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  menu: <path d="M4 8h16M4 16h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  chat: <path d="M20.5 11.5a8.5 8.5 0 01-12.4 7.6L3.5 20.5l1.4-4.6A8.5 8.5 0 1120.5 11.5z" />,
  tag: (
    <>
      <path d="M3.5 12.4V4.5a1 1 0 011-1h7.9a1 1 0 01.7.3l7.6 7.6a1 1 0 010 1.4l-7.9 7.9a1 1 0 01-1.4 0l-7.6-7.6a1 1 0 01-.3-.7z" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="2" />
      <path d="M9 4.5V3.5h6v1M8.5 12.5l2.3 2.3 4.7-4.8" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
