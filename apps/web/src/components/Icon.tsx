const PATHS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  grid: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z M15 9a4 4 0 0 1 0 6 M18 6a8 8 0 0 1 0 12",
  coins: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 7v10 M9.5 9.8c0-1 1-1.6 2.5-1.6s2.5.6 2.5 1.6-1 1.5-2.5 1.5-2.5.6-2.5 1.6 1 1.6 2.5 1.6 2.5-.6 2.5-1.6",
  chart: "M3 20h18 M6 20v-8 M12 20V5 M18 20v-11",
  sparkles: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  calendar: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5",
  film: "M4 5h16v14H4z M8 5v14 M16 5v14 M4 9h4 M4 15h4 M16 9h4 M16 15h4",
  store: "M4 9l1-5h14l1 5 M4 9v11h16V9 M9 20v-6h6v6 M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0",
  card: "M3 6h18v12H3z M3 10h18 M7 15h3",
  bell: "M6 17v-6a6 6 0 0 1 12 0v6l2 2H4z M10 21h4",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
  box: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  plug: "M9 3v5 M15 3v5 M6 8h12v4a6 6 0 0 1-12 0z M12 18v3",
  target: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M12 12h.01",
  calc: "M5 3h14v18H5z M8 7h8 M8 12h2 M14 12h2 M8 16h2 M14 16h2",
  alert: "M12 3l10 18H2z M12 10v5 M12 18h.01",
  database: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  sliders: "M4 6h10 M18 6h2 M4 12h4 M12 12h8 M4 18h12 M20 18h0 M14 4v4 M8 10v4 M16 16v4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "M6 6l12 12 M18 6 6 18",
  logout: "M9 4H5v16h4 M16 8l4 4-4 4 M20 12H9",
  play: "M8 5v14l11-7z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  copy: "M9 9h11v11H9z M5 15V4h11",
  arrowLeft: "M15 5l-7 7 7 7",
  arrowRight: "M9 5l7 7-7 7",
  plus: "M12 5v14 M5 12h14",
  download: "M12 4v12 M7 11l5 5 5-5 M5 20h14",
  upload: "M12 16V4 M7 9l5-5 5 5 M5 20h14",
  arrowUp: "M12 19V5 M6 11l6-6 6 6",
  arrowDown: "M12 5v14 M6 13l6 6 6-6",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  image: "M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M9 9.5h.01",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
} as const;

export type IconName = keyof typeof PATHS;

/** Ícones de traço simples, desenhados à mão para o app (sem biblioteca externa nem requisição de rede). */
export function Icon({ name, className = "h-[18px] w-[18px]" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" focusable="false">
      {PATHS[name].split(" M").map((d, i) => (
        <path key={i} d={i === 0 ? d : `M${d}`} />
      ))}
    </svg>
  );
}

/** Marca do app: um brilho de oito pontas. */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="#c8420f" />
      <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
        <path d="M16 6v6M16 20v6M6 16h6M20 16h6M9 9l4 4M19 19l4 4M23 9l-4 4M13 19l-4 4" />
      </g>
    </svg>
  );
}
