import { useId } from "react";

export function StormIcon() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
    <path d="M23 3c-8-1-16 5-16 12 0 5 4 9 9 9 6 0 10-5 9-10M9 29c8 1 16-5 16-12 0-5-4-9-9-9-6 0-10 5-9 10" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"/>
    <circle cx="16" cy="16" r="4" fill="currentColor"/>
  </svg>;
}

/** A still, fully local illustration for the no-WebGL map and legacy view.
 * No independent animation clock: paused and reduced-motion scenery stays still. */
export function StormArtwork({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return <svg className={className} viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-storm-artwork>
    <defs>
      <linearGradient id={`${id}-sky`} x2="0" y2="1"><stop stopColor="#142943"/><stop offset=".65" stopColor="#446c80"/><stop offset="1" stopColor="#6d969e"/></linearGradient>
      <linearGradient id={`${id}-water`} x2="0" y2="1"><stop stopColor="#1b657a"/><stop offset="1" stopColor="#0a304c"/></linearGradient>
      <radialGradient id={`${id}-cloud`}><stop stopColor="#b3cbd0"/><stop offset=".64" stopColor="#7896a8"/><stop offset="1" stopColor="#344e6b"/></radialGradient>
      <radialGradient id={`${id}-eye`}><stop stopColor="#1e344e"/><stop offset=".65" stopColor="#36556b"/><stop offset="1" stopColor="#96b2bd"/></radialGradient>
    </defs>
    <path fill={`url(#${id}-sky)`} d="M0 0h800v500H0z"/>
    <ellipse cx="400" cy="280" rx="310" ry="50" fill="#112d43" opacity=".3"/>
    <g transform="translate(400 181) rotate(-12)">
      <ellipse rx="280" ry="119" fill={`url(#${id}-cloud)`}/>
      <g transform="scale(1 .5)">{[0, 1, 2, 3].map(arm => <g key={arm} transform={`rotate(${arm * 90})`}>
        <path d="M38 0C55-101 202-145 272-76C317-32 292 33 248 64C201 96 131 91 95 71" fill="none" stroke="#7898aa" strokeWidth="63" strokeLinecap="round"/>
        <path d="M40 1C59-73 168-115 238-85C265-73 277-53 274-34" fill="none" stroke="#afc8cf" strokeWidth="22" strokeLinecap="round" opacity=".65"/>
      </g>)}</g>
      {Array.from({ length: 22 }, (_, index) => {
        const angle = index / 22 * Math.PI * 2;
        const x = Math.cos(angle) * (147 + index % 3 * 16), y = Math.sin(angle) * (66 + index % 2 * 12);
        return <ellipse key={index} cx={x} cy={y} rx={43 + index % 4 * 5} ry={26 + index % 3 * 3} fill={`url(#${id}-cloud)`} opacity=".8"/>;
      })}
      <ellipse rx="62" ry="38" fill={`url(#${id}-eye)`}/>
      <path d="M-53-3c1-29 66-48 94-22" stroke="#c0d2d6" strokeWidth="13" fill="none" strokeLinecap="round"/>
    </g>
    <g stroke="#b8d9df" strokeWidth="2" opacity=".38">{Array.from({ length: 42 }, (_, i) => <path key={i} d={`M${70 + (i * 71) % 690} ${160 + (i * 37) % 165}l-15 39`}/>)}</g>
    <path d="m224 237-18 36h22l-31 52 13-41h-21l23-47" fill="#d8edf2" opacity=".76"/>
    <path d="M0 360q56-23 111 0t111 0t111 0t111 0t111 0t111 0t134 0v140H0Z" fill={`url(#${id}-water)`}/>
    <g fill="none" strokeLinecap="round">
      <path d="M-10 390q60-32 120 0t120 0t120 0m-65 51q70-34 140 0t140 0t140 0" stroke="#6faeb5" strokeWidth="7"/>
      <path d="M32 393q20-13 46-7m233 56q26-11 43-9m226-24q50-35 89-8" stroke="#d3e7df" strokeWidth="4"/>
      <path d="M78 465q35-13 72-3m303 14 70-10m185-7 60-7" stroke="#8ec2c5" strokeWidth="3" opacity=".6"/>
    </g>
    <g transform="translate(488 340) rotate(-13)">
      <path d="m-75 22 155-4-30 43H-41Z" fill="#913e35" stroke="#e1b47b" strokeWidth="4"/>
      <path d="m-60 34 120-3-7 10H-50Z" fill="#f0c693"/>
      <path d="M0-108V19" stroke="#d9c99c" strokeWidth="6"/>
      <path d="M6-97 57 1H8Z" fill="#f7e7b3"/><path d="M-7-83-47 2H-7Z" fill="#d4d7c2"/>
      <path d="M-8-105 19-99 7-88-8-93Z" fill="#e57d4f"/>
      <path d="M-21 13h40v15h-40Z" fill="#ede1b3"/><circle cx="-39" cy="29" r="4" fill="#273f4c"/>
    </g>
    <path d="M397 400q27-19 52-12m87 20q28 5 54-4m-77 13 36 1" fill="none" stroke="#d0e8e1" strokeWidth="5" strokeLinecap="round"/>
  </svg>;
}
