import { useId } from "react";

/** The cinematic's still frame when WebGL is unavailable. No timer or animation. */
export function CrystalFallStill({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const landings = [
    [233, 154], [243, 151], [266, 163], [287, 176], [266, 189], [239, 191],
    [221, 215], [257, 222], [280, 232], [303, 212], [318, 188], [338, 161],
    [361, 159], [381, 177], [393, 198], [369, 217], [346, 233], [368, 253],
    [398, 270], [419, 292], [416, 319], [391, 342], [368, 359], [358, 327],
    [312, 269], [297, 295], [307, 322], [287, 346], [463, 187], [488, 219],
    [493, 253], [476, 278],
  ];
  const traces = [0, 3, 6, 8, 10, 12, 14, 16, 18, 21, 23, 25, 27, 29, 31, 30];
  return <svg className={className} viewBox="0 0 720 500" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Tideheart shards scattered across Oceania" focusable="false" data-crystal-fall-still>
    <defs>
      <radialGradient id={`${id}-space`} cx=".5" cy=".4"><stop stopColor="#1a4965" /><stop offset="1" stopColor="#081c31" /></radialGradient>
      <radialGradient id={`${id}-ocean`} cx=".32" cy=".27"><stop stopColor="#65bec6" /><stop offset=".5" stopColor="#287f98" /><stop offset="1" stopColor="#123e65" /></radialGradient>
      <radialGradient id={`${id}-atmosphere`}><stop offset=".84" stopColor="#49c6e5" stopOpacity="0" /><stop offset=".93" stopColor="#6ceaff" stopOpacity=".35" /><stop offset="1" stopColor="#65d9f2" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${id}-impact`}><stop stopColor="#eaffff" stopOpacity=".98" /><stop offset=".14" stopColor="#8ef5ff" stopOpacity=".8" /><stop offset=".44" stopColor="#54dbea" stopOpacity=".3" /><stop offset="1" stopColor="#56dfee" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}-land`} x2=".7" y2="1"><stop stopColor="#b6cf98" /><stop offset=".5" stopColor="#75a98b" /><stop offset="1" stopColor="#397c7c" /></linearGradient>
      <radialGradient id={`${id}-shade`} cx=".25" cy=".3"><stop offset=".45" stopColor="#021a39" stopOpacity="0" /><stop offset="1" stopColor="#051931" stopOpacity=".64" /></radialGradient>
      <linearGradient id={`${id}-arc`}><stop stopColor="#cefaff" stopOpacity=".05" /><stop offset=".58" stopColor="#83eaff" stopOpacity=".58" /><stop offset="1" stopColor="#ddffff" stopOpacity="1" /></linearGradient>
      <clipPath id={`${id}-planet`}><circle cx="360" cy="255" r="169" /></clipPath>
    </defs>
    <path d="M0 0h720v500H0Z" fill={`url(#${id}-space)`} />
    <g fill="#c3e8e9">
      {Array.from({ length: 52 }, (_, i) => <circle key={i} cx={24 + i * 137 % 670} cy={22 + i * 83 % 447} r={i % 7 === 0 ? 1.4 : .7} opacity={.19 + (i % 4) * .1} />)}
    </g>
    <circle cx="360" cy="255" r="188" fill={`url(#${id}-atmosphere)`} />
    <circle cx="360" cy="255" r="169" fill={`url(#${id}-ocean)`} />
    <g clipPath={`url(#${id}-planet)`}>
      <g fill="none" stroke="#99d7d3" strokeWidth="1" opacity=".19">
        <path d="M218 247q49-17 80-9m101 141q55-26 94-21M182 290q49-21 102-13m143-150q48 8 77 23M256 383q40-13 64-9M432 213q22-7 41-2" />
        <path d="M207 167q16-8 26-7m144 132q22-12 43-6m22 52 42-8m-171-186 25-4M267 258l35-6m159 40 28-2" />
      </g>
      <g fill={`url(#${id}-land)`} stroke="#b5d4ac" strokeWidth="1.7" strokeLinejoin="round">
        <path d="m211 146 23-21 17 8 10 17 25-3 16 20 30 7-5 23-20 7 3 17-19 19-19 1-14-12-28 2-12-12 8-14-21-13 5-14-13-14Z" />
        <path d="m321 151 22-12 31 7 19 20-5 17 15 13-1 19-20 8-18-4-11 22-18-9 8-24-9-12 12-20-24-8Z" />
        <path d="m363 242 20-8 20 18 4 15 24 14 9 27-12 16-3 24-20 3-23 25-22-6-6-24-10-14 8-21-11-22 8-26Z" />
        <path d="m307 259 18 5 5 18-13 21 7 17-20 24-7 20-19-13 2-21-13-11 16-23-2-18Z" />
        <path d="m453 177 22-6 13 16 13 11 6 28-12 14 10 17-6 25-22 13-16-12 5-20-9-15 17-17-19-23Z" />
        <path d="m453 306 22 3 6 15-13 17-16-3-12 16-12-10 8-20Z" />
        <path d="m319 371 21-5 17 13-8 16-24 2-13-14Z" />
        <path d="m254 283 11 2 5 14-10 11-15-8Z" />
      </g>
      <g fill="#e4ede0" opacity=".9"><path d="m239 110 21-15 44-12 43-6 47 1 40 15-3 11-29-3-14 11-34-7-24 9-27-8-23 12Z" /><path d="m275 409 20-9 34 4 19-8 20 9 39-4 41 19-51 20-99-8Z" /></g>
      <g fill="#d6d8bf" stroke="#6d9990" strokeWidth="1">
        <path d="m235 179 8-15 11 17-8-3-5 3Z" /><path d="m251 186 10-17 10 19-9-4-5 3Z" />
        <path d="m362 193 8-17 10 18-9-5-3 4Z" /><path d="m379 296 9-19 12 23-13-7Z" />
        <path d="m389 314 9-22 15 25-13-9Z" /><path d="m465 236 8-20 11 22-12-6Z" />
      </g>
      <g fill="none" stroke="#d0e8dd" strokeWidth="4" strokeLinecap="round" opacity=".44"><path d="M220 259q29-19 58-7m123-121q34-5 59 15m-107 214q-19 16-54 15M443 262q-11 5-20 2" /></g>
      <circle cx="360" cy="255" r="169" fill={`url(#${id}-shade)`} />
    </g>
    <g fill="none" stroke={`url(#${id}-arc)`} strokeLinecap="round">
      {traces.map((index, arc) => {
        const [x, y] = landings[index];
        const controlX = 267 + (x - 267) * .42 + (arc % 2 ? 12 : -12);
        const controlY = Math.min(y, 167) - 76 - (arc % 4) * 19;
        return <g key={index}>
          <path d={`M267 167Q${controlX} ${controlY} ${x} ${y}`} strokeWidth="5" opacity=".11" />
          <path d={`M267 167Q${controlX} ${controlY} ${x} ${y}`} strokeWidth="1.25" opacity={.45 + arc % 3 * .15} />
        </g>;
      })}
    </g>
    {landings.map(([x, y], index) => <g key={index} transform={`translate(${x} ${y})`} data-shard-landing>
      <circle r="15" fill={`url(#${id}-impact)`} />
      <ellipse cy="2.5" rx="6" ry="2.8" fill="none" stroke="#a2f0ee" strokeWidth=".8" opacity=".65" />
      <path d="M0-6 3 0 0 5-3 0Z" fill="#c7ffff" stroke="#efffff" strokeWidth=".7" />
      <path d="M-5 0H5M0-8V7" stroke="#edffff" strokeWidth=".7" opacity=".8" />
    </g>)}
    <g transform="translate(267 167)"><circle r="30" fill={`url(#${id}-impact)`} /><path d="M0-16 3-4 14-8 6 0 17 5 4 6 0 18-4 5-16 8-6 0-14-6-3-4Z" fill="#dbffff" opacity=".86" /></g>
  </svg>;
}
