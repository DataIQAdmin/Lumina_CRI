// A small, consistent icon set: 24-unit grid, 1.75 stroke, round caps. Drawn by hand for this app.

const PATHS = {
  overview: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  customers:
    'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.87M15.5 3.63a3.5 3.5 0 0 1 0 6.74',
  merge: 'M6 3v6a6 6 0 0 0 6 6h6M6 21v-6M18 12l3 3-3 3M3 18h6',
  connectors: 'M12 3c4.97 0 8 1.34 8 3s-3.03 3-8 3-8-1.34-8-3 3.03-3 8-3M4 6v6c0 1.66 3.03 3 8 3s8-1.34 8-3V6M4 12v6c0 1.66 3.03 3 8 3s8-1.34 8-3v-6',
  cloud: 'M7 18h10.5a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.34 10.1 4 4 0 0 0 7 18',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  neq: 'M5 9h14M5 15h14M16 5L8 19',
  minus: 'M6 12h12',
  chevronRight: 'M9 6l6 6-6 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  sliders: 'M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4',
  key: 'M15 7a4 4 0 1 1-3.9 4.9L4 19v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7zM16 10h.01',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01',
  shield: 'M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z',
  power: 'M12 3v8M6.4 6.4a8 8 0 1 0 11.2 0',
  logo: 'M5 4v16h14M9 16l3-4 3 2 4-6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5',
  audit: 'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2M8 12h8M8 16h5',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  approve: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
} as const

export type IconName = keyof typeof PATHS

interface IconProps {
  name: IconName
  size?: number
  className?: string
  label?: string // give a label only when the icon is the only thing explaining a control
}

export function Icon({ name, size = 18, className, label }: IconProps) {
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
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
