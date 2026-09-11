/* Renders the small markdown subset the assistant is told to produce:
   headings, bullets, **bold**, and ==highlighted numbers==. */

import type { JSX } from "react";

function inline(s: string): JSX.Element[] {
  return String(s)
    .split(/(\*\*[^*]+\*\*|==[^=]+==)/g)
    .map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
        return <strong key={i}>{inline(part.slice(2, -2))}</strong>;
      if (part.startsWith("==") && part.endsWith("==") && part.length > 4)
        return (
          <mark key={i} className="mark">
            {part.slice(2, -2)}
          </mark>
        );
      return <span key={i}>{part}</span>;
    });
}

export function Rich({ text }: { text: string }) {
  const out: JSX.Element[] = [];
  let list: string[] = [];
  const flush = (k: string | number) => {
    if (list.length) {
      out.push(
        <ul key={`u${k}`}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  String(text || "")
    .split("\n")
    .forEach((ln, i) => {
      const t = ln.trim();
      if (/^[-•*]\s+/.test(t)) list.push(t.replace(/^[-•*]\s+/, ""));
      else {
        flush(i);
        if (/^#{1,3}\s/.test(t)) out.push(<h4 key={i}>{inline(t.replace(/^#{1,3}\s/, ""))}</h4>);
        else if (t) out.push(<p key={i}>{inline(t)}</p>);
      }
    });
  flush("end");
  return <div className="rich">{out}</div>;
}
