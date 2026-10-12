// Inline icon system ported from the approved mockup (stroke-based, RTL-safe).
const P: Record<string, string> = {
  dash:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  create:'<path d="M12 5v14M5 12h14"/>',
  spark:'<path d="M12 3l1.9 4.8L19 9.6l-4.3 3.1L15.4 18 12 15.2 8.6 18l.7-5.3L5 9.6l5.1-1.8L12 3z"/>',
  library:'<path d="M4 5.5A1.5 1.5 0 015.5 4H9l2 2.5h7.5A1.5 1.5 0 0120 8v10a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18V5.5z"/>',
  cal:'<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
  checkc:'<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/>',
  send:'<path d="M21 4L3 10.5l7 2.7L12.7 21 21 4z"/>',
  wa:'<path d="M20 11.5a8 8 0 01-11.8 7L4 20l1.6-4A8 8 0 1120 11.5z"/>',
  palette:'<path d="M12 3a9 9 0 000 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.8-1.7 1.7-1.7H16a5 5 0 005-5c0-4-4-7.3-9-7.3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  plug:'<path d="M9 3v6M15 3v6M6.5 9h11v3a5.5 5.5 0 01-11 0V9zM12 17.5V21"/>',
  users:'<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0111 0M16 5.2a3.2 3.2 0 010 5.9M17.5 20h3a4.6 4.6 0 00-3-4.3"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.2a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.2a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.2a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.2a1.6 1.6 0 00-1.5 1z"/>',
  buoy:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.6"/><path d="M14.6 9.4L18 6M6 18l3.4-3.4M14.6 14.6L18 18M6 6l3.4 3.4"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  bell:'<path d="M18 9a6 6 0 10-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9zM10.3 19.5a2 2 0 003.4 0"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.7 9.4a2.4 2.4 0 114.1 1.7c-.8.7-1.8 1.1-1.8 2.2"/><path d="M12 17h.01"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  bldg:'<path d="M5 21V5.5A1.5 1.5 0 016.5 4h6A1.5 1.5 0 0114 5.5V21M14 10h3.5A1.5 1.5 0 0119 11.5V21M3 21h18M8 8h3M8 12h3M8 16h3"/>',
  chevL:'<path d="M15 5l-7 7 7 7"/>',
  chevR:'<path d="M9 5l7 7-7 7"/>',
  chevD:'<path d="M6 9l6 6 6-6"/>',
  img:'<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 15.5l-4.5-4.2L7 19.5"/>',
  doc:'<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  deck:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8.5 20h7"/>',
  vid:'<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M15 10.5L21 7v10l-6-3.5z"/>',
  upload:'<path d="M12 16V4M8 8l4-4 4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 1.8"/>',
  alert:'<path d="M12 4.5l9 15.5H3l9-15.5zM12 10v4M12 17.2h.01"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  edit:'<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3z"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  more:'<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  back:'<path d="M20 12H4M10 6l-6 6 6 6"/>',
  fwd:'<path d="M4 12h16M14 6l6 6-6 6"/>',
  filter:'<path d="M4 5h16l-6.2 7.3V19l-3.6-2v-4.7L4 5z"/>',
  grid:'<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  refresh:'<path d="M20 11a8 8 0 10-1.6 5.5M20 5v6h-6"/>',
  shield:'<path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6L12 3z"/>',
  arch:'<rect x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19V8.5M10 12.5h4"/>',
  undo:'<path d="M4 9h11a5 5 0 010 10h-4M4 9l4-4M4 9l4 4"/>',
  down:'<path d="M12 4v12M7.5 11.5L12 16l4.5-4.5M5 20h14"/>',
  pause:'<path d="M9 5v14M15 5v14"/>',
  play:'<path d="M7 4.5l12 7.5-12 7.5v-15z"/>',
  msg:'<path d="M21 11.5a7.5 7.5 0 01-11 6.6L4 20l1.9-5.4A7.5 7.5 0 1121 11.5z"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
  link:'<path d="M10.5 13.5a4 4 0 005.7 0l2.6-2.6a4 4 0 00-5.7-5.7l-1.3 1.3M13.5 10.5a4 4 0 00-5.7 0l-2.6 2.6a4 4 0 005.7 5.7l1.3-1.3"/>',
  dept:'<path d="M12 3v6M6 21v-5a3 3 0 013-3h6a3 3 0 013 3v5M6 21H4M20 21h-2M9 9h6v3H9z"/>',
  note:'<path d="M5 4h14v11l-5 5H5V4z"/><path d="M19 15h-5v5"/>',
  ok:'<circle cx="12" cy="12" r="9"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/>',
  hist:'<path d="M3.5 12a8.5 8.5 0 108.5-8.5c-2.6 0-4.9 1.2-6.4 3M4 4v4h4M12 8v4.3l3 1.7"/>',
  ver:'<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.5 6h4a3 3 0 013 3v.8M8.5 18h4a3 3 0 003-3v-.6"/>',
  year:'<rect x="3.5" y="4.5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v3M16 3v3M7.5 13h1.5M11.2 13h1.6M15 13h1.5M7.5 16.8h1.5M11.2 16.8h1.6M15 16.8h1.5"/>',
  inbox:'<path d="M3.5 13.5h4l1.5 3h6l1.5-3h4"/><path d="M5.6 5.2l-2.1 8.3V19a2 2 0 002 2h13a2 2 0 002-2v-5.5l-2.1-8.3A2 2 0 0016.5 4h-9a2 2 0 00-1.9 1.2z"/>'
};

export function Ic({ n, s = 18, sw = 1.7 }: { n: string; s?: number; sw?: number }) {
  return (
    <svg
      width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: P[n] ?? '' }}
    />
  );
}
