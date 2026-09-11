export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "table": return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg>;
    case "sliders": return <svg {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>;
    case "truck": return <svg {...p}><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></svg>;
    case "doc": return <svg {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></svg>;
    case "box": return <svg {...p}><path d="M3 8l9-5 9 5-9 5-9-5zM3 8v8l9 5 9-5V8M12 13v8" /></svg>;
    case "note": return <svg {...p}><path d="M5 4h14v12l-4 4H5z" /><path d="M15 20v-4h4M8 9h8M8 13h5" /></svg>;
    case "plus": return <svg {...p}><path d="M12 5v14M5 12h14" /></svg>;
    case "send": return <svg {...p}><path d="M4 12l16-8-6 16-3-7z" /></svg>;
    case "x": return <svg {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case "pin": return <svg {...p}><path d="M9 3h6l-1 6 3 3H7l3-3zM12 12v9" /></svg>;
    case "print": return <svg {...p}><path d="M7 8V3h10v5M7 17H4v-7h16v7h-3" /><rect x="7" y="14" width="10" height="7" /></svg>;
    case "spark": return <svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" /></svg>;
    case "quote": return <svg {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></svg>;
    case "compare": return <svg {...p}><path d="M5 20V10M12 20V4M19 20v-7" /></svg>;
    case "copy": return <svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>;
    case "check": return <svg {...p}><path d="M4 12.5l5 5L20 6.5" /></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "users": return <svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 11a3 3 0 100-6M18 20c0-2.4-.9-4.2-2.3-5.2" /></svg>;
    case "building": return <svg {...p}><path d="M4 21V5l8-2v18M12 21h8V9l-8-2M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2" /></svg>;
    case "gear": return <svg {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" /></svg>;
    case "download": return <svg {...p}><path d="M12 3v12M7 11l5 5 5-5M4 20h16" /></svg>;
    case "upload": return <svg {...p}><path d="M12 20V8M7 12l5-5 5 5M4 4h16" /></svg>;
    case "search": return <svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>;
    case "back": return <svg {...p}><path d="M15 5l-7 7 7 7" /></svg>;
    case "trash": return <svg {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>;
    case "shield": return <svg {...p}><path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;
    case "history": return <svg {...p}><path d="M3 12a9 9 0 106-8.5M3 4v4h4" /><path d="M12 8v4.5l3 1.5" /></svg>;
    case "logout": return <svg {...p}><path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9" /></svg>;
    case "alert": return <svg {...p}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17h.01" /></svg>;
    case "file": return <svg {...p}><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></svg>;
    default: return null;
  }
}
