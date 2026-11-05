const paths = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a5 5 0 0 1 10 0v3M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  warning: <><path d="m12 3 10 18H2zM12 9v5M12 17h.01" /></>,
  settings: <><path d="M4 7h16M4 17h16M9 4v6M16 14v6" /></>,
  generate: <><path d="m4 20 11-11M12 4l1 2M19 11l2 1M5 5l2 1M19 3l1 2M17 17l1 2" /><path d="m13 8 3 3" /></>,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
}
export default function ScheduleIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" className="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
