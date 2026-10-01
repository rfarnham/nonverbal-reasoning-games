import { useId } from "react";

/** A cleared sea passage for maps without WebGL. The encounter's painting
 * belongs to its story and must not make a cleared danger appear active. */
export function CalmPassageArtwork({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return <svg className={className} viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" data-calm-passage>
    <defs>
      <linearGradient id={`${id}-sky`} x2="0" y2="1"><stop stopColor="#bddce3"/><stop offset="1" stopColor="#f7edc6"/></linearGradient>
      <linearGradient id={`${id}-sea`} x2="0" y2="1"><stop stopColor="#67adb4"/><stop offset="1" stopColor="#1e6b85"/></linearGradient>
    </defs>
    <path fill={`url(#${id}-sky)`} d="M0 0h800v500H0z"/>
    <circle cx="595" cy="108" r="39" fill="#fff5d0" opacity=".8"/>
    <path d="M0 203q130-8 260 0t280 0t260 0v297H0Z" fill={`url(#${id}-sea)`}/>
    <g fill="none" stroke="#c3e1d4" strokeWidth="2.5" strokeLinecap="round" opacity=".7">
      <path d="M46 241q40-6 78-1m447-8 91 4M102 344q64-8 131-3m304 23 115-4M54 447l91-5m360 0q89-9 158 1M280 417l81-4m-92-166 87-3"/>
      <path d="M362 337q44-7 91 0m-112 17q50-6 111 0"/>
    </g>
    <g transform="translate(400 296)">
      <path d="m-61 8 124-2-24 35h-72Z" fill="#87553c" stroke="#daba83" strokeWidth="3"/>
      <path d="M0-109V9" stroke="#e3c38b" strokeWidth="5"/>
      <path d="M6-100 50 0H6Z" fill="#fff1ca"/><path d="M-7-83-43 0H-7Z" fill="#e5d6b4"/>
      <path d="m0-108 26 7-26 9" fill="#c16a49"/><circle cx="45" cy="10" r="5" fill="#9ef5eb"/>
    </g>
    <path d="M151 109q9-10 18 0 9-10 18 0m37 20q7-7 14 0 7-7 14 0" fill="none" stroke="#52767c" strokeWidth="2"/>
  </svg>;
}
