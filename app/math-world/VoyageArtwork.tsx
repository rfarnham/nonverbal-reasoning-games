"use client";

import { useEffect, useId, useRef } from "react";
import { createSceneryClock } from "./scenery-clock";
import { getSceneryPaused, subscribeSceneryPreference } from "./scenery-preference";
import type { StoryIllustration } from "./story-content";
import styles from "./voyage-artwork.module.css";

export type VoyageIllustration = "chart" | "beacon" | "wind" | "sails" | "reforging" | "ascent";

export function isVoyageIllustration(kind: StoryIllustration): kind is VoyageIllustration {
  return kind === "chart" || kind === "beacon" || kind === "wind" || kind === "sails"
    || kind === "reforging" || kind === "ascent";
}

function Vessel({ x = 0, y = 0, scale = 1, starSails = false, crystal = false, prefix }: {
  x?: number; y?: number; scale?: number; starSails?: boolean; crystal?: boolean; prefix: string;
}) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-45 0H48L29 23H-25Z" fill="#795339" stroke="#efd8a2" strokeWidth="2" />
    <path d="M-33 8H35m-61 7H27" fill="none" stroke="#462f2b" strokeWidth="1.2" opacity=".65" />
    <path d="M0-74V1m-2-58-29 55m35-65 34 64" fill="none" stroke="#bca36e" strokeWidth="2" />
    <path d="M5-68 36-7H5Z" fill={starSails ? "#d8f2e9" : "#fff2cd"} stroke="#c1b385" strokeWidth="1" />
    <path d="M-5-59-31-7H-5Z" fill={starSails ? "#b7d9d5" : "#e8cf98"} stroke="#a39776" strokeWidth="1" />
    <path d="m0-77 21 5-21 8" fill="#b97653" stroke="#e5c48e" strokeWidth="1" />
    {starSails && <g fill="none" stroke="#fffce4" strokeWidth="1.3" strokeLinecap="round">
      <path d="M17-43v9m-4-4h8m-35 6v8m-4-4h8M25-23v6m-3-3h6" />
    </g>}
    <g transform="translate(-17 -3)">
      <circle cy="-12" r="5" fill="#dec59b" stroke="#554b3c" strokeWidth="1.2" />
      <path d="M-6 0v-8q6-7 12 0v8" fill="#bf7052" stroke="#554b3c" strokeWidth="1" />
    </g>
    {crystal && <g transform="translate(20 -20) scale(.24)"><Tideheart prefix={prefix} /></g>}
  </g>;
}

function Tideheart({ prefix }: { prefix: string }) {
  return <g>
    <circle r="91" fill={`url(#${prefix}-glow)`} />
    <path d="M0-66 41-4 0 59-41-4Z" fill="#8de7f1" stroke="#d7fcff" strokeWidth="2" />
    <path d="M0-66 0-4-41-4Z" fill="#d9fbff" />
    <path d="M0-66 41-4 0-4Z" fill="#4eb5cb" />
    <path d="M-41-4 0-4 0 59Z" fill="#297fa0" />
    <path d="M0-4 41-4 0 59Z" fill="#bcf5f6" />
    <path d="M0-66V59M-41-4H41" fill="none" stroke="#f0ffff" strokeWidth="1.5" />
    <path d="m-15-31 15 15 14-15M-13 10H13M-6 22H6" fill="none" stroke="#eaffff" strokeWidth="1.4" opacity=".8" />
  </g>;
}

function Ocean({ prefix }: { prefix: string }) {
  return <>
    <path d="m-20 165 66-58 35 13 34-39 31 40 31-13 38 57m191-3 36-41 30 9 45-55 33 34 39-12 68 70" fill="#748d74" stroke="#6c7d66" strokeWidth="1.3" />
    <path d="m95 118 20-37 31 40-17-12-15 7m375 13 36-54 33 34-20-9-11 10" fill="#c4c4a0" opacity=".75" />
    <path d="M0 163q65-14 130 0t130 0t130 0t130 0t130 0v80H0Z" fill={`url(#${prefix}-sea)`} />
    <g fill="none" stroke="#c5ddd0" strokeWidth="1.4" opacity=".72">
      <path d="M28 181q39-6 76-1m77 13 66-4m182-1 72 4M69 218l105-3m213 8 67-4m75-12 62 2M11 171q44-6 87 0m446 1 64 6" />
    </g>
  </>;
}

function Village({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M0 0v-33h25V0m10 0v-44h29V0m10 0v-32h28V0" fill="#efdbb2" stroke="#627867" strokeWidth="1.5" />
    <path d="m-4-33 16-17 17 17m2-11 18-18 19 18m2 12 17-14 19 14" fill="#ac7452" stroke="#735d46" strokeWidth="1" />
    <path d="M9-18h7v10H9m34-22h10v11H43m39 9h10v12H82" fill="#617e76" />
    <path d="M27 4h97m-11 0v19m-23-19v19" stroke="#765540" strokeWidth="4" />
  </g>;
}

function Compass({ x, y, scale = 1, veiled = false }: { x: number; y: number; scale?: number; veiled?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} fill="none" stroke="#695839" strokeWidth="1.4">
    <circle r="31" /><circle r="25" opacity=".45" />
    <path d="M0-43V43M-43 0H43m-27-27 54 54m0-54-54 54" opacity=".6" />
    <path d="M0-28 7-7 28 0 7 7 0 28-7 7-28 0-7-7Z" fill="#e4c78d" />
    <path d="M0-28 7-7 0 0-7 7-28 0-7-7Z" fill="#5d6d64" stroke="none" />
    {veiled && <path d="M-31-11q30 12 62 0l-6 22q-25 11-50 0Z" fill="#394d4b" stroke="#394d4b" />}
  </g>;
}

function Voyager({ x, y, coat = "#a8664d", scale = 1 }: { x: number; y: number; coat?: string; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} stroke="#5c5141" strokeWidth="1.3" strokeLinecap="round">
    <circle cy="-30" r="6" fill="#dcc4a0" />
    <path d="M-6-25q6-4 12 0l4 17H-10Z" fill={coat} />
    <path d="M-5-8-6 0M5-8 6 0M-7-21-14-14M7-21 14-14" fill="none" />
  </g>;
}

function Globe({ prefix }: { prefix: string }) {
  return <g transform="translate(322 181) scale(.68)">
    <circle r="100" fill={`url(#${prefix}-glow)`} />
    <circle r="83" fill={`url(#${prefix}-planet)`} stroke="#cee4cb" strokeWidth="1.8" />
    <path d="m-50-47 23-20 27 4 8 17-18 10-8 17-23 3-18-12Zm64 52 17-22 22 11 12 28-21 8-5 24-22 11-15-24Zm-67 11 15-14 18 5 10 20-17 13-19-6Z" fill="#a5b78b" stroke="#c5cdab" strokeWidth="1.3" />
    <g fill="none" stroke="#e7e5c1" opacity=".43"><ellipse rx="43" ry="83" /><ellipse rx="83" ry="28" /><path d="M-83 0H83M0-83V83" /></g>
    <path d="m42-57 8-6 10 5-4 9-11 3m-37 65 7-3 5 6-7 5" fill="#afbe95" />
  </g>;
}

/** The finale has one short visual sequence. The final picture is also the
 * server-rendered, paused, and reduced-motion picture; story navigation never
 * waits for the animation. Hidden/offscreen time does not consume the sequence. */
function useVoyageSequence(svgRef: React.RefObject<SVGSVGElement | null>, kind: VoyageIllustration) {
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || (kind !== "reforging" && kind !== "ascent")) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const shards = [...svg.querySelectorAll<SVGGElement>("[data-tide-shard]")];
    const heart = svg.querySelector<SVGGElement>("[data-reforged-heart]");
    const ship = svg.querySelector<SVGGElement>("[data-rising-ship]");
    const signal = svg.querySelector<SVGGElement>("[data-blue-signal]");
    const duration = kind === "reforging" ? 4.8 : 6;
    let complete = getSceneryPaused() || typeof IntersectionObserver === "undefined";
    let onScreen = false;
    let alive = true;

    const paint = (progress: number) => {
      const ease = progress * progress * (3 - 2 * progress);
      svg.dataset.sequence = progress >= 1 ? "still" : "playing";
      if (kind === "reforging") {
        const gather = Math.min(1, ease / .82);
        shards.forEach(shard => {
          const x = Number(shard.dataset.x) * (1 - gather);
          const y = Number(shard.dataset.y) * (1 - gather);
          shard.setAttribute("transform", `translate(${320 + x} ${103 + y}) rotate(${Number(shard.dataset.angle) * (1 - gather)})`);
          shard.setAttribute("opacity", String(Math.max(0, 1 - Math.max(0, gather - .72) / .28)));
        });
        heart?.setAttribute("opacity", String(Math.max(0, Math.min(1, (gather - .5) / .5))));
      } else {
        ship?.setAttribute("transform", `translate(320 ${174 - 77 * ease}) scale(${.72 + .28 * ease})`);
        signal?.setAttribute("opacity", String(Math.max(0, Math.min(1, (ease - .48) / .52))));
      }
    };

    paint(complete ? 1 : 0);
    const clock = createSceneryClock({
      request: callback => requestAnimationFrame(callback),
      cancel: id => cancelAnimationFrame(id),
      now: () => performance.now(),
      onFrame: seconds => {
        if (!alive) return;
        paint(Math.min(1, seconds / duration));
        if (seconds >= duration) { complete = true; clock.setRunning(false); }
      },
    });
    const reconcile = () => {
      if (reduced.matches && !complete) { complete = true; paint(1); }
      clock.setRunning(alive && !complete && !getSceneryPaused() && !document.hidden && onScreen);
    };
    const observer = typeof IntersectionObserver === "undefined" ? null
      : new IntersectionObserver(entries => { onScreen = entries.some(entry => entry.isIntersecting); reconcile(); });
    observer?.observe(svg);
    reduced.addEventListener("change", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    const unsubscribe = subscribeSceneryPreference(reconcile);
    reconcile();
    return () => {
      alive = false;
      clock.dispose();
      observer?.disconnect();
      reduced.removeEventListener("change", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
      unsubscribe();
    };
  }, [kind, svgRef]);
}

/** Local ink-and-wash pictures for the voyage after the sundering. */
export function VoyageArtwork({ kind, className }: { kind: VoyageIllustration; className?: string }) {
  const prefix = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  useVoyageSequence(svgRef, kind);
  const night = kind === "ascent" || kind === "reforging";
  return <svg ref={svgRef} className={`${styles.artwork}${className ? ` ${className}` : ""}`}
    viewBox="0 0 640 240" aria-hidden="true" focusable="false" data-voyage-artwork={kind} data-sequence="still">
    <defs>
      <linearGradient id={`${prefix}-sky`} x2="0" y2="1"><stop stopColor={night ? "#172b42" : "#d9e5d8"} /><stop offset="1" stopColor={night ? "#52777d" : "#f5e7c9"} /></linearGradient>
      <linearGradient id={`${prefix}-sea`} x2="0" y2="1"><stop stopColor="#78aaa4" /><stop offset="1" stopColor="#346d78" /></linearGradient>
      <linearGradient id={`${prefix}-paper`} x2="1" y2="1"><stop stopColor="#f7ebcc" /><stop offset="1" stopColor="#d6c18c" /></linearGradient>
      <radialGradient id={`${prefix}-glow`}><stop stopColor="#9bf7fc" stopOpacity=".85" /><stop offset=".44" stopColor="#6be1ee" stopOpacity=".3" /><stop offset="1" stopColor="#6be1ee" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${prefix}-planet`} cx=".32" cy=".23"><stop stopColor="#84c8be" /><stop offset="1" stopColor="#2d6676" /></radialGradient>
      <clipPath id={`${prefix}-cut`}><rect x="1" y="1" width="638" height="238" rx="108" /></clipPath>
    </defs>
    <g clipPath={`url(#${prefix}-cut)`}>
      <path d="M0 0h640v240H0Z" fill={`url(#${prefix}-sky)`} />
      {!night && <circle cx="489" cy="48" r="25" fill="#efd391" opacity=".8" />}
      {night ? <g fill="#f6eac8" opacity=".8">
        {[[115, 39], [174, 66], [234, 26], [382, 31], [459, 55], [512, 31], [545, 96], [89, 101], [404, 87], [204, 101]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.6 : 1} />)}
        <path d="M155 25v8m-4-4h8m318 77v10m-5-5h10" fill="none" stroke="#f6eac8" strokeWidth="1.1" />
      </g> : <g fill="none" stroke="#93aa99" strokeWidth="1.2" opacity=".6">
        <path d="M43 55q33-15 66-5m-59 13q43-10 74-4m299-23q37-10 72-1m-42 13 65-3" />
      </g>}

      {kind === "chart" && <>
        <path d="M93 36 523 30 553 208 78 213Z" fill={`url(#${prefix}-paper)`} stroke="#978354" strokeWidth="2" />
        <path d="m108 49 400-5 24 148-436 7Z" fill="none" stroke="#ad9462" strokeWidth="1.2" />
        <g fill="none" stroke="#b8a477" strokeWidth=".7" opacity=".7"><path d="M119 86h395M112 130h407m-414 45h424M172 52l-11 142m90-145-4 145m89-145 7 145m72-145 17 145" /></g>
        <path d="m161 61 35 11 15 26-15 16 20 25-8 37-43 15-28-31 5-44-15-29Z" fill="#9ba783" stroke="#697a65" strokeWidth="1.8" />
        <path d="m371 71 34-18 43 17 17 27-11 24-24 1-27 37-32-7-10-21 18-20Z" fill="#99a481" stroke="#697a65" strokeWidth="1.8" />
        <path d="m254 180 20-19 24 8 8 24-26 8Z" fill="#9ba783" stroke="#697a65" strokeWidth="1.8" />
        <path d="M226 127q82-70 145-25m-146 31q67 11 133-2" fill="none" stroke="#826b42" strokeWidth="1.8" strokeDasharray="4 5" />
        <path d="m290 89 13 40m-5-39 13 39" stroke="#5f6657" strokeWidth="3" />
        <g fill="#5f6657"><circle cx="290" cy="89" r="5" /><circle cx="306" cy="131" r="5" /></g>
        <path d="m286 120 10-3m-7-6 10-3m-7-6 10-3" stroke="#d7c392" strokeWidth="2" />
        <Compass x={463} y={161} scale={.68} />
        <Compass x={104} y={126} scale={.59} veiled />
        <path d="M489 214q33-65 52-84-4 49-50 86m4-10 39-65m-28 48 13-3m-6-14 13-3" fill="#e5debd" stroke="#81714d" strokeWidth="1.3" />
      </>}

      {(kind === "beacon" || kind === "wind" || kind === "sails") && <Ocean prefix={prefix} />}
      {kind === "beacon" && <>
        <path d="m87 183 44-20 56-3 45 26-8 23H87Z" fill="#8e9679" stroke="#606f5e" strokeWidth="1.5" />
        <path d="m133 171 10-105h34l11 105Z" fill="#e6d6b0" stroke="#62786f" strokeWidth="2" />
        <path d="M140 94h40m-42 24h45m-45 27h48" stroke="#a5aa8c" strokeWidth="2" />
        <path d="M139 68V45h42v23Zm-6-24 27-18 27 18Z" fill="#91694b" stroke="#5a6c62" strokeWidth="2" />
        <path d="M149 63V51h23v12" fill="#f4eac4" stroke="#5a6c62" strokeWidth="1.2" />
        <path d="m180 53 294-24v49L180 63Z" fill="#f6e8aa" opacity=".35" />
        <path d="M151 172v-19a10 10 0 0 1 20 0v19" fill="#536d65" stroke="#738374" strokeWidth="1.5" />
        <Voyager x={218} y={187} scale={1.36} coat="#6b857b" />
        <path d="M203 154q12-12 29 0" fill="none" stroke="#5c5141" strokeWidth="3" />
        <circle cx="244" cy="160" r="23" fill={`url(#${prefix}-glow)`} />
        <path d="m244 148 7 11-7 12-7-12Z" fill="#c5f4ef" stroke="#34859a" strokeWidth="1" />
        <Vessel x={374} y={189} scale={.9} prefix={prefix} />
        <path d="M334 214q25-5 50 0t48 0" fill="none" stroke="#c4ded1" strokeWidth="1.4" />
        <path d="M393 86q7-7 14 0 7-7 14 0m36 13q5-5 10 0 5-5 10 0" fill="none" stroke="#54746b" strokeWidth="1.6" />
      </>}

      {kind === "wind" && <>
        <path d="M71 205q57-50 114-45l29 50Z" fill="#96a58a" stroke="#6f816b" strokeWidth="1.5" />
        <path d="M119 166h111m-92 0v34m74-34v34" fill="none" stroke="#816144" strokeWidth="4" />
        {[142, 174, 206].map((x, i) => <g key={x} transform={`translate(${x} 156)`}>
          <path d="M-9 0v-17q0-7 5-10v-10H4v10q5 3 5 10V0Z" fill={i === 0 ? "#bdcba7" : "#a8c5b5"} stroke="#687d6c" strokeWidth="1.5" />
          <path d="M-5-39H5v4H-5Z" fill="#9b7e54" />
          <path d="M-4-17q7-5 8 2t-8 5" fill="none" stroke="#e8f0cd" strokeWidth="1" />
        </g>)}
        <Voyager x={105} y={191} coat="#ac7654" />
        <g fill="none" stroke="#8da99b" strokeWidth="2" strokeLinecap="round" opacity=".8">
          <path d="M179 114q44-25 98-9t80-3q20-12 9-24-9-9-17-2m-142 51q62-10 105 2t79-3m-151 19q54-5 95 10t69-1q17-8 7-17" />
        </g>
        <Vessel x={424} y={185} scale={1.03} prefix={prefix} />
        <path d="M381 216q31-5 58 0t40-1" fill="none" stroke="#c3dfd1" strokeWidth="1.4" />
      </>}

      {kind === "sails" && <>
        <path d="M402 177q29-34 58-27t100 9v23Z" fill="#8fa07e" />
        <Village x={424} y={162} scale={.88} />
        <Vessel x={283} y={174} scale={1.18} prefix={prefix} />
        <Vessel x={400} y={209} scale={.61} prefix={prefix} />
        <Vessel x={164} y={199} scale={.57} prefix={prefix} />
        <path d="M83 188h105m-95-1v31m82-31v29" stroke="#7e5f40" strokeWidth="4" />
        <path d="M111 160q28-12 51 3l-7 22h-41Z" fill="#f8ebc8" stroke="#ad9869" strokeWidth="1.4" />
        <path d="m130 162 1 5m1 4 1 5m1 4 1 4" stroke="#8d7750" strokeWidth="1.1" />
        <Voyager x={92} y={188} coat="#ac7153" /><Voyager x={178} y={189} coat="#718c7b" />
        <path d="M213 74q6-6 12 0 6-6 12 0m126-20q5-5 10 0 5-5 10 0" fill="none" stroke="#57766a" strokeWidth="1.5" />
      </>}

      {kind === "reforging" && <>
        <path d="M0 177q80-7 160 0t160 0t160 0t160 0v66H0Z" fill="#426c73" />
        <Village x={477} y={174} scale={.68} /><Village x={83} y={171} scale={.66} />
        <path d="M76 178h125m-101 0v16m77-16v16m267-16h127m-101 0v17m77-17v17" stroke="#8c7254" strokeWidth="4" />
        <Voyager x={153} y={178} coat="#9388a0" scale={.78} /><Voyager x={185} y={178} coat="#b68155" scale={.78} />
        <Voyager x={457} y={178} coat="#8a9e8c" scale={.78} /><Voyager x={491} y={178} coat="#bb8862" scale={.78} />
        <path d="M194 190H446L414 225H229Z" fill="#78533e" stroke="#e2cb93" strokeWidth="2" />
        <path d="M213 199h218m-207 9h198m-188 9h180" fill="none" stroke="#392f2d" strokeWidth="1.2" opacity=".65" />
        <path d="M207 186h228m-9-1V69m-198 116V51" fill="none" stroke="#c0a87a" strokeWidth="3" />
        <path d="M209 80h58m135 5h47m-23 7-45 94m-153-99 51 99" fill="none" stroke="#baa67b" strokeWidth="1.3" />
        <path d="M235 84h22l-10 53h-12Zm184 5h-13l6 42h7Z" fill="#d4d8bc" stroke="#a9ad8b" strokeWidth="1" />
        <path d="M263 185v-9h17v-9h80v9h17v9Z" fill="#899e91" stroke="#d6d5b5" strokeWidth="1.6" />
        <path d="m280 155 9 14h62l9-14" fill="none" stroke="#e5dbb8" strokeWidth="2" />
        <path d="M192 233q36-6 69-1m115 0q34-6 70-1M59 204l87-3m337 11 74-3" fill="none" stroke="#9ebfb4" strokeWidth="1.2" opacity=".65" />
        <g data-reforged-heart="" transform="translate(320 103)"><Tideheart prefix={prefix} /></g>
        {Array.from({ length: 32 }, (_, i) => {
          const angle = i * Math.PI * 2 / 32;
          const x = Math.cos(angle) * (i % 2 ? 120 : 159);
          const y = Math.sin(angle) * (i % 2 ? 61 : 81);
          return <g key={i} data-tide-shard="" data-x={x} data-y={y} data-angle={i * 17}
            transform={`translate(${320 + x} ${103 + y})`} opacity="0">
            <path d="M0-7 5 0 0 8-4 0Z" fill={i % 3 ? "#b8f3f3" : "#69c5d8"} stroke="#e3ffff" strokeWidth=".8" />
          </g>;
        })}
      </>}

      {kind === "ascent" && <>
        <Globe prefix={prefix} />
        <g data-blue-signal="" opacity="1" fill="none" stroke="#b1f1ee">
          <path d="M340 79 268 149m72-70 38 76m-38-76-18 73" strokeWidth="1.3" opacity=".48" />
          <path d="M268 161q54-29 112 0m-125 22q67-30 133 0" strokeWidth="1.8" opacity=".7" />
          <circle cx="287" cy="164" r="13" fill={`url(#${prefix}-glow)`} stroke="none" />
          <circle cx="353" cy="184" r="13" fill={`url(#${prefix}-glow)`} stroke="none" />
        </g>
        <path d="M201 161q-3-49 40-91m-27 72q9-22 27-36" fill="none" stroke="#b7d2c5" strokeWidth="1.4" opacity=".55" />
        <g data-rising-ship="" transform="translate(320 97)"><Vessel starSails crystal prefix={prefix} /></g>
        <path d="M429 174q57-5 73 13m-27-34 29 14" fill="none" stroke="#7b9893" strokeWidth="1.2" opacity=".6" />
      </>}
    </g>
    <rect x="1.5" y="1.5" width="637" height="237" rx="108" fill="none" stroke="#8d774c" strokeWidth="1.5" />
    <path d="M17 92V80m0 83v-12m606-59V80m0 83v-12" stroke="#bca66d" strokeWidth="4" strokeLinecap="round" />
  </svg>;
}
