import { useId } from "react";
import LegacyCoastScene from "./LegacyCoastScene";
import { getWorldMapLayout, type MapIsland, type MapLandscape, type MapLayout } from "./map-layouts";
import { WORLD_MODE } from "./world-data";

type CoastSceneProps = {
  mobile?: boolean;
  completedCount?: number;
  className?: string;
  worldNumber?: number;
  completedRoadSlot?: number;
  showDetours?: boolean;
};

type Theme = {
  sky: string; deep: string; grass: string; edge: string; cliff: string;
  light: string; leaf: string; darkLeaf: string; accent: string; road: string;
};

// The palette supports each landscape's terrain and landmarks. Its silhouette,
// route, island composition, and scenery also change between worlds.
const THEMES: Record<MapLandscape, readonly [Theme, Theme]> = {
  coast: [
    { sky: "#8eecea", deep: "#25a9ce", grass: "#bfe96d", edge: "#ffe3a2", cliff: "#c08d51", light: "#effcbd", leaf: "#35bb73", darkLeaf: "#188864", accent: "#f07659", road: "#f8d783" },
    { sky: "#a0eadb", deep: "#219cae", grass: "#b9dd68", edge: "#fff0b8", cliff: "#cb9653", light: "#e9f9c0", leaf: "#38ad7f", darkLeaf: "#217c68", accent: "#f7a95e", road: "#ffdd93" },
  ],
  mirror: [
    { sky: "#c6ebf6", deep: "#719fd6", grass: "#d3eac1", edge: "#efecd0", cliff: "#81a6b5", light: "#edfbe9", leaf: "#bba7e8", darkLeaf: "#8d75bd", accent: "#c987d9", road: "#f6e7b1" },
    { sky: "#e2d6f3", deep: "#978fc8", grass: "#d3e7d6", edge: "#faf0d7", cliff: "#8d9dbe", light: "#f3f9f6", leaf: "#e3acd6", darkLeaf: "#bb80b6", accent: "#8879cc", road: "#f9e7bd" },
  ],
  orchard: [
    { sky: "#91e0cf", deep: "#39aba0", grass: "#d2e97b", edge: "#f3d18b", cliff: "#b99052", light: "#f0f8b6", leaf: "#60b84f", darkLeaf: "#31874c", accent: "#ee8354", road: "#fae0a0" },
    { sky: "#a5e4d6", deep: "#58aca9", grass: "#f0da80", edge: "#f8e0a6", cliff: "#bb945b", light: "#fff2b8", leaf: "#c3ba53", darkLeaf: "#818a41", accent: "#e48349", road: "#fce8b6" },
  ],
  pattern: [
    { sky: "#c2dafa", deep: "#799bcf", grass: "#ddcbed", edge: "#f5dec6", cliff: "#a889b0", light: "#f6eaf9", leaf: "#8ac7c0", darkLeaf: "#519e9e", accent: "#e190bb", road: "#fae4b6" },
    { sky: "#c6d9f1", deep: "#638ebc", grass: "#bce2db", edge: "#f3d9a9", cliff: "#77aeb2", light: "#e8faf0", leaf: "#9c9fd6", darkLeaf: "#6a72ae", accent: "#eda4c0", road: "#f8dda6" },
  ],
  shapes: [
    { sky: "#9de4eb", deep: "#45a4c3", grass: "#cceaa9", edge: "#e6deae", cliff: "#80b49f", light: "#f0f6c9", leaf: "#61c4ad", darkLeaf: "#329b91", accent: "#eead60", road: "#f6e3a5" },
    { sky: "#acdfe5", deep: "#438faf", grass: "#bee2be", edge: "#f7d7a6", cliff: "#82aeb1", light: "#e2f2d4", leaf: "#97bfc8", darkLeaf: "#638f9f", accent: "#e7b562", road: "#f9e0ac" },
  ],
  lagoon: [
    { sky: "#a1e8ed", deep: "#349fb8", grass: "#c8e4b3", edge: "#f7dbb6", cliff: "#b89388", light: "#eaf9d1", leaf: "#eaa294", darkLeaf: "#ca7b83", accent: "#ebbd71", road: "#fbe5b9" },
    { sky: "#bbcfe9", deep: "#7186b6", grass: "#d8cce9", edge: "#f8d9bf", cliff: "#ac87ad", light: "#f4e6ed", leaf: "#c6a2d9", darkLeaf: "#997ab6", accent: "#edb394", road: "#f6dcc0" },
  ],
  desert: [
    { sky: "#f4ddb0", deep: "#d5b277", grass: "#f5d68c", edge: "#fff0bd", cliff: "#c19059", light: "#fff1c5", leaf: "#79b777", darkLeaf: "#478763", accent: "#d9855c", road: "#fff1c3" },
    { sky: "#e9c5b0", deep: "#bd936d", grass: "#ebc076", edge: "#ffe4a5", cliff: "#ac7a54", light: "#ffe5ae", leaf: "#7cac89", darkLeaf: "#527f73", accent: "#cc725c", road: "#ffebb8" },
  ],
  canopy: [
    { sky: "#b0e4bc", deep: "#489b8e", grass: "#a7d27a", edge: "#e9d394", cliff: "#957e53", light: "#dbeeaa", leaf: "#58af79", darkLeaf: "#2b846b", accent: "#efb06c", road: "#eac48a" },
    { sky: "#c0dcca", deep: "#5b9690", grass: "#cad08d", edge: "#ebd49b", cliff: "#9b825d", light: "#e9e8b5", leaf: "#a8b776", darkLeaf: "#6e9473", accent: "#e9a478", road: "#f4d59b" },
  ],
  cliffs: [
    { sky: "#c8e6f5", deep: "#81aacd", grass: "#daebe1", edge: "#f0f1db", cliff: "#86aeb7", light: "#f7fcf2", leaf: "#9ac7bb", darkLeaf: "#629fa6", accent: "#d69aaa", road: "#f8e5b7" },
    { sky: "#c4d6ec", deep: "#6983a9", grass: "#e9efed", edge: "#f9f4da", cliff: "#91a9bb", light: "#ffffff", leaf: "#a6c4d3", darkLeaf: "#7394b1", accent: "#cda2c4", road: "#f6e5bf" },
  ],
  balance: [
    { sky: "#d9cef2", deep: "#9488c3", grass: "#dbe3ae", edge: "#f9e9bd", cliff: "#a799ab", light: "#f8f3d3", leaf: "#caacd7", darkLeaf: "#9c82b6", accent: "#e4b078", road: "#f9dfb1" },
    { sky: "#e6d8ed", deep: "#a78bb5", grass: "#e2ddb2", edge: "#f8e8cb", cliff: "#b197ab", light: "#f9f2d8", leaf: "#bea4cc", darkLeaf: "#967ab0", accent: "#e3a993", road: "#f7dfb9" },
  ],
};

// Solid silhouettes: pools and terraces are surface details, so every map
// anchor belongs to usable land rather than a decorative hole in an atoll.
const SHAPES: Record<MapIsland["shape"], string> = {
  bean: "M-98 4C-106-48-56-97-8-86C28-118 88-79 93-28C117 16 91 65 49 74C18 112-49 91-57 68C-89 74-103 40-98 4Z",
  leaf: "M-100 4C-79-80-10-108 53-75C88-58 98-8 100 30C64 94-12 101-70 56C-89 43-99 28-100 4Z",
  diamond: "M-98-10-48-71 27-92 97-28 76 54 4 93-72 61Z",
  crescent: "M-95-17C-78-84-14-102 49-74C66-66 83-51 91-29C65-38 55-28 60-8C78 1 91 1 100-11C110 50 62 96-15 83C-69 97-112 39-95-17Z",
  cloud: "M-98 0C-109-37-78-57-50-52C-44-105 12-112 34-74C72-90 108-58 90-18C120 14 93 62 58 60C24 108-18 90-33 67C-70 87-111 47-98 0Z",
  mesa: "M-96-34-71-78-10-86 29-69 81-77 100-25 82 21 87 65 23 85-26 71-79 82-100 35Z",
  ring: "M-100-7C-90-73-40-94 8-83C44-106 92-64 94-17C115 32 70 92 28 84C-25 107-85 63-90 34Z",
  petal: "M-93-10C-99-61-53-97-12-71C13-111 72-94 77-49C110-31 109 32 76 42C61 101 9 100-16 73C-72 88-106 43-93-10Z",
  terrace: "M-94-24-68-78-20-78-4-93 45-77 86-76 101-29 80-6 94 32 58 70 22 70 0 91-62 78-98 35Z",
  atoll: "M-99 2C-102-53-64-83-18-73C17-106 72-84 87-41C104-20 110 19 88 44C63 85 5 85-29 67C-77 93-111 39-99 2Z",
};

function Land({ island, theme, landscape, mobile }: { island: MapIsland; theme: Theme; landscape: MapLandscape; mobile: boolean }) {
  const cliffDepth = landscape === "cliffs" ? (mobile ? 24 : 36) : landscape === "canopy" ? 21 : 14;
  const d = SHAPES[island.shape];
  const shape = (dy: number, fill: string, stroke?: string, strokeWidth = 0) => <path data-island-surface={dy === 0 ? "true" : undefined} d={d} transform={`translate(${island.x} ${island.y + dy}) rotate(${island.rotation ?? 0}) scale(${island.rx / 100} ${island.ry / 100})`} fill={fill} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />;
  return <g data-island-id={island.id}>
    {shape(cliffDepth + 6, theme.deep, theme.light, mobile ? 7 : 9)}
    <g opacity=".4">{shape(cliffDepth + 13, theme.deep)}</g>
    {shape(cliffDepth, theme.cliff)}
    {landscape === "cliffs" && shape(cliffDepth * .57, theme.edge)}
    {shape(5, theme.edge, theme.edge, mobile ? 5 : 7)}
    {shape(0, theme.grass, theme.light, 2)}
  </g>;
}

type DecorationProps = { theme: Theme; variant: 1 | 2; index: number };

function Palm({ theme, bend = 1 }: { theme: Theme; bend?: number }) {
  return <g transform={`scale(${bend} 1)`}>
    <path d="M-4 5Q13-28 0-64L8-64Q27-27 5 7Z" fill="#b8874b" />
    <path d="M1-61C-32-88-45-66-49-49Q-20-64 1-57C-20-56-25-33-23-21Q-4-44 6-54C13-38 31-33 44-37Q29-61 10-61C31-62 46-74 48-84Q18-85 6-67C7-90-11-98-22-95Q-13-68 1-61Z" fill={theme.darkLeaf} />
    <path d="M3-64Q-16-77-37-64M7-63Q24-73 37-76M7-59Q21-48 32-44" fill="none" stroke={theme.leaf} strokeWidth="7" strokeLinecap="round" />
    <circle cx="3" cy="-56" r="6" fill="#d0a063" /><circle cx="12" cy="-54" r="5" fill="#b78550" />
  </g>;
}

function Lighthouse({ theme, variant, index }: DecorationProps) {
  if (index === 0) return <>
    <g transform="translate(-14 4)"><Palm theme={theme} bend={-1} /></g>
    {variant === 2 && <g transform="translate(40 5) scale(.7)"><Palm theme={theme} /></g>}
    <path d="M-46 8Q-9 21 45 10" fill="none" stroke={theme.light} strokeWidth="6" strokeLinecap="round" />
    <path d="M30-6 34 2 43 3 36 9 38 18 30 13 21 18 23 9 16 3 25 2Z" fill={theme.accent} />
  </>;
  if (index === 1) return <>
    <path d="M-50 6H50M-40-9V19M-19-9V19M19-9V19M40-9V19" fill="none" stroke="#b38851" strokeWidth="7" strokeLinecap="round" />
    {variant === 1 ? <>
      <path d="M-34-1V-53H34V-1" fill="#fff2c7" stroke="#a2855b" strokeWidth="3" />
      <path d="M-34-27H34M-20-2V-52M20-2V-52" stroke="#dbbc84" strokeWidth="3" />
      <path d="M-44-53-31-78H31L44-53Z" fill={theme.accent} stroke="#b68658" strokeWidth="3" strokeLinejoin="round" />
      <path d="M-18-77-23-54M2-77V-54M20-77 25-54" stroke="#fff6df" strokeWidth="9" />
      <path d="M-11-1V-30Q0-43 11-30V-1Z" fill="#4d8c92" />
    </> : <>
      <path d="M-37 0V-37Q-37-89 0-91Q37-89 37-37V0H19V-35Q19-66 0-66Q-19-66-19-35V0Z" fill="#faf0c9" stroke="#b59c72" strokeWidth="3" />
      <path d="M-40-37Q-40-92 0-96Q40-92 40-37" fill="none" stroke={theme.accent} strokeWidth="9" />
      <path d="M-21-8H21L11 3H-11Z" fill={theme.leaf} />
      <path d="M-16-70-10-58M16-70 10-58M0-89V-70" stroke="#cdbb90" strokeWidth="3" />
    </>}
  </>;
  if (index === 2) return <>
    <ellipse cy="7" rx="63" ry="17" fill="#75cecd" /><path d="M-49 6Q-28 14-8 8M14 12H40" fill="none" stroke="#dff8e8" strokeWidth="3" strokeLinecap="round" />
    <path d="M-44-7H44L28 9H-27Z" fill="#fff5d7" stroke="#758d88" strokeWidth="3" /><path d="M-41-5H41L33 2H-34Z" fill={theme.accent} />
    <path d="M-4-9V-99" fill="none" stroke="#527e81" strokeWidth="4" strokeLinecap="round" />
    <path d="M-10-89-41-20H-10Z" fill="#fff8dc" /><path d="M3-88 35-20H3Z" fill={theme.accent} stroke="#be8b64" strokeWidth="2" />
    <path d="M-3-99 21-92-3-85Z" fill="#f4cf68" />
    {variant === 2 && <g transform="translate(46 7) scale(.55)"><path d="M-23-3H25L14 11H-14Z" fill="#fff1c7" /><path d="M-1-7V-64L23-9H3Z" fill={theme.leaf} stroke={theme.darkLeaf} strokeWidth="3" /></g>}
  </>;
  return <>
    {variant === 2 && <g transform="translate(-39 5) scale(.65)"><Palm theme={theme} bend={-1} /></g>}
    <path d="M-25 6-17-78H17L25 6Z" fill="#fff9dd" stroke="#4b7776" strokeWidth="3" />
    <path d="M-21-39H21L23-20H-23ZM-18-75H18L20-58H-20Z" fill={theme.accent} />
    <path d="M-7 6V-11Q0-25 7-11V6Z" fill="#366777" />
    <rect x="-21" y="-100" width="42" height="25" rx="3" fill="#486b7a" />
    <path d="M-14-95H14V-79H-14Z" fill="#ffe891" /><path d="M0-94V-80" stroke="#fff9e4" strokeWidth="3" />
    <path d="M-28-99 0-120 28-99Z" fill={theme.accent} stroke="#ba785c" strokeWidth="3" strokeLinejoin="round" />
    <path d="M0-122V-142M1-142 22-136 1-130Z" fill="#f8d66f" stroke="#537477" strokeWidth="2.5" />
    {variant === 2 && <path d="M25-84 76-108V-62Z" fill="#fff3bc" opacity=".5" />}
  </>;
}

function MirrorGarden({ theme, variant, index }: DecorationProps) {
  return <>
    <ellipse cy="-4" rx="70" ry="21" fill={theme.edge} /><ellipse cy="-7" rx="61" ry="16" fill="#8acada" />
    <path d="M-45-8H-13M12-5H43M-11 1H16" stroke="#e6fbf8" strokeWidth="3" strokeLinecap="round" />
    {[-1, 1].map(side => <g key={side} transform={`translate(${side * 38} -12)`}>
      {variant === 1 ? <>
        <path d="M-8 0V-50H8V0Z" fill="#a2acbf" />
        <path d="M-19-53Q-22-87 0-103Q22-87 19-53Z" fill={theme.leaf} stroke={theme.darkLeaf} strokeWidth="3" />
        <path d="M0-91V-62" stroke={theme.light} strokeWidth="4" strokeLinecap="round" />
      </> : <>
        <path d="M-19 0-21-48-7-82 15-59 22-12 8 2Z" fill={theme.darkLeaf} />
        <path d="M-19-48-7-82 2-46-6-3Z" fill="#eee9fc" /><path d="M2-46 15-59 22-12 8 2Z" fill="#bbcee9" />
        <path d="M-7-82 15-59 2-46Z" fill="#fffaff" />
      </>}
    </g>)}
    {index % 2 === 1 && <path d="M-26-18Q0-48 26-18" fill="none" stroke={theme.accent} strokeWidth="7" strokeLinecap="round" />}
  </>;
}

function FruitTree({ theme, variant, index }: DecorationProps) {
  return <>
    <path d="M-7 5-5-55H5L8 5Z" fill="#9c7950" /><path d="M0-29-20-48M1-39 19-56" stroke="#9c7950" strokeWidth="7" />
    <path d="M-36-42C-59-55-41-84-26-82C-30-105 3-119 17-96C43-109 58-73 39-61C51-36 11-24 0-38C-10-25-32-28-36-42Z" fill={theme.darkLeaf} />
    <ellipse cx="-5" cy="-78" rx="31" ry="25" fill={theme.leaf} />
    {[[-26, -65], [3, -88], [27, -65], [-2, -47]].map(([x, y], fruitIndex) => <g key={fruitIndex} transform={`translate(${x} ${y})`}>
      <circle r={variant === 2 ? 9 : 8} fill={fruitIndex % 2 === index % 2 ? theme.accent : "#f4c557"} />
      <path d="M0-7 3-12" stroke="#4f8851" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M-3-4-4-2" stroke="#ffedbc" strokeWidth="2.5" strokeLinecap="round" />
    </g>)}
  </>;
}

function Orchard({ theme, variant, index }: DecorationProps) {
  if (variant === 2 && index === 3) return <>
    <path d="M-46 4V-39L0-80 46-39V4Z" fill="#e3f2cd" stroke={theme.darkLeaf} strokeWidth="4" />
    <path d="M-46-39H46M-25 4V-57M0 4V-77M25 4V-57" stroke="#85a886" strokeWidth="3" />
    <path d="M-53-39 0-88 53-39" fill="none" stroke={theme.accent} strokeWidth="8" strokeLinejoin="round" />
    <g transform="translate(-24 3) scale(.4)"><FruitTree theme={theme} variant={variant} index={index} /></g>
    <g transform="translate(24 3) scale(.4)"><FruitTree theme={theme} variant={variant} index={index + 1} /></g>
  </>;
  return <>
    <g transform="translate(-32 3) scale(.78)"><FruitTree theme={theme} variant={variant} index={index} /></g>
    <g transform="translate(30 -5)"><FruitTree theme={theme} variant={variant} index={index + 1} /></g>
    {variant === 2 && <path d="M-66 5Q-25 18 66 7M-59 17Q-10 27 51 19" fill="none" stroke={theme.edge} strokeWidth="6" strokeLinecap="round" />}
  </>;
}

function PatternGarden({ theme, variant, index }: DecorationProps) {
  return <>
    {[-1, 0, 1].map((column) => <g key={column} transform={`translate(${column * 38} ${column === 0 ? -20 : 3}) scale(${column === 0 ? 1 : .7})`}>
      <path d="M-7 4-10-43H10L7 4Z" fill="#fcf1d6" stroke="#8e899d" strokeWidth="3" />
      {variant === 1 ? <>
        <path d="M-36-38C-35-91 35-91 36-38Q0-25-36-38Z" fill={column === 0 ? theme.accent : theme.leaf} stroke={theme.darkLeaf} strokeWidth="3" />
        <path d="M-17-65-10-34M7-72 18-35" stroke="#fff1df" strokeWidth="10" />
        <path d="M-36-38Q0-25 36-38" fill="none" stroke={theme.darkLeaf} strokeWidth="3" />
      </> : <>
        <path d="M-34-43-23-73 0-88 24-73 35-43 0-31Z" fill={theme.leaf} stroke={theme.darkLeaf} strokeWidth="3" />
        <path d="M-32-44 0-63 31-44M-23-71 0-50 24-71" fill="none" stroke={index % 2 ? theme.accent : theme.light} strokeWidth="9" strokeLinejoin="round" />
      </>}
    </g>)}
  </>;
}

function Shapes({ theme, variant, index }: DecorationProps) {
  return <>
    <g transform="translate(-25 0)">
      <path d="M-32-13 0-32 34-13 2 7Z" fill={theme.light} /><path d="M-32-13V-49L2-30V7Z" fill={theme.leaf} /><path d="M2 7V-30L34-49V-13Z" fill={theme.darkLeaf} /><path d="M-32-49 0-68 34-49 2-30Z" fill={theme.light} />
      {variant === 2 && <g transform="translate(1 -40) scale(.74)"><path d="M-32-49 0-68 34-49 2-30Z" fill="#fff2c4" /><path d="M-32-49V-13L2 7V-30Z" fill={theme.accent} /><path d="M2-30 34-49V-13L2 7Z" fill="#c69264" /></g>}
    </g>
    <path d={index % 2 === 0 ? "M19 0 48-83 79 0Z" : "M23-6V-49A26 26 0 0 1 75-49V-6Z"} fill={theme.accent} stroke="#b38d62" strokeWidth="3" strokeLinejoin="round" />
    <path d={index % 2 === 0 ? "M48-82 50-3H76Z" : "M61-68V-6H74V-46Q74-61 61-68Z"} fill="#ce935a" />
  </>;
}

function LagoonArch({ theme, variant, index }: DecorationProps) {
  return <>
    <ellipse cy="3" rx="67" ry="19" fill="#6fc8cb" /><ellipse cy="3" rx="51" ry="11" fill="#b6ede4" />
    <path d="M-49 4V-35C-49-109 49-109 49-35V4H25V-36C25-73-25-73-25-36V4Z" fill={theme.leaf} stroke={theme.darkLeaf} strokeWidth="4" />
    <path d="M-35-42Q-33-76-8-79" fill="none" stroke={theme.light} strokeWidth="9" strokeLinecap="round" />
    <path d="M-45-17H-29M29-20H45M-37-54-26-48M27-52 38-59M-9-87-8-63M16-82 12-61" stroke={theme.darkLeaf} strokeWidth="3" />
    {variant === 2 && <g transform="translate(0 -88)"><path d="M-22 0-35-31-8-19 0-49 12-21 33-35 22 0Z" fill={theme.accent} stroke={theme.darkLeaf} strokeWidth="3" strokeLinejoin="round" /></g>}
    <path d={`M${index % 2 ? -66 : 64} 9v-36m0 15q-17 0-15-16m15 7q15 0 15-13`} fill="none" stroke={theme.accent} strokeWidth="7" strokeLinecap="round" />
  </>;
}

function DesertRuin({ theme, variant, index }: DecorationProps) {
  return <>
    <path d="M-75 6Q-35-49 10 5Q41-35 78 6Z" fill="#f8de9c" /><path d="M-75 6Q-35-49 10 5" fill="none" stroke={theme.light} strokeWidth="5" />
    {index % 2 === 0 ? <>
      <path d="M-23 5V-65H23V5H9V-29Q0-43-9-29V5Z" fill="#d7a369" stroke="#ad8055" strokeWidth="3" />
      <path d="M-30-65-22-81H22L30-65Z" fill={theme.edge} stroke="#ad8055" strokeWidth="3" />
      <path d="M-23-50H23M-23-34H-11M11-34H23M-23-17H-10M10-17H23" stroke="#b78455" strokeWidth="3" />
      {variant === 2 && <path d="M-26-81 0-112 26-81Z" fill={theme.accent} stroke="#ad8055" strokeWidth="3" />}
    </> : <>
      <path d="M0 5V-76M-1-30Q-30-25-30-54M1-44Q26-40 26-67" fill="none" stroke={theme.darkLeaf} strokeWidth="17" strokeLinecap="round" />
      <path d="M-4 4V-76M-29-31V-54M22-46V-67" fill="none" stroke={theme.leaf} strokeWidth="6" strokeLinecap="round" />
      <path d="M-7-79-6-90 1-85 7-91 9-79Z" fill={theme.accent} />
      {variant === 2 && <g transform="translate(39 5) scale(.6)"><path d="M-19 0V-68H19V0Z" fill="#deaf7a" /><path d="M-25-68H25V-82H-25Z" fill={theme.edge} /><path d="M-8-10V-56M6-10V-56" stroke="#b98a5e" strokeWidth="4" /></g>}
    </>}
  </>;
}

function CanopyHouse({ theme, variant, index }: DecorationProps) {
  return <>
    <path d="M-16 13-10-94H10L19 13Z" fill="#ad8253" /><path d="M-4 4-1-77" stroke="#d6af77" strokeWidth="7" strokeLinecap="round" />
    <path d="M-64-71C-93-98-51-126-25-116C-20-151 29-154 41-118C75-124 93-89 62-67C48-42 11-55-2-63C-26-43-54-50-64-71Z" fill={theme.darkLeaf} />
    <path d="M-68-88C-66-117-28-119-15-109C-8-140 29-139 39-113C62-114 77-95 63-81C34-73 28-90 7-83C-22-70-39-96-68-88Z" fill={theme.leaf} />
    <path d="M-29-22V-63H30V-22Z" fill="#f4d99e" stroke="#987349" strokeWidth="3" /><path d="M-37-63 0-92 38-63Z" fill={theme.accent} stroke="#987349" strokeWidth="3" strokeLinejoin="round" />
    <path d="M-7-22V-46H8V-22Z" fill="#527d76" /><path d="M-14-21V16M14-21V16M-14-10H14M-14 1H14M-14 12H14" stroke="#8e7149" strokeWidth="3.5" />
    {variant === 2 && <g transform={`translate(${index % 2 ? -52 : 52} -26) scale(.7)`}><path d="M-22 0V-32H22V0Z" fill="#f9e6b8" stroke="#987349" strokeWidth="3" /><path d="M-29-32 0-56 29-32Z" fill={theme.accent} stroke="#987349" strokeWidth="3" /><circle cy="-15" r="7" fill="#658e83" /></g>}
  </>;
}

function CliffTowers({ theme, variant, index }: DecorationProps) {
  return <>
    {[-1, 0, 1].map(column => {
      const top = column === 0 ? -105 : column === (index % 2 ? 1 : -1) ? -72 : -47;
      return <g key={column} transform={`translate(${column * 31} 0)`}>
        <path d={`M-21 0V${top + 12}L0 ${top} 23 ${top + 12}V0L0 12Z`} fill={theme.cliff} stroke={theme.darkLeaf} strokeWidth="2.5" />
        <path d={`M0 12V${top + 24}L23 ${top + 12}V0Z`} fill={theme.darkLeaf} />
        <path d={`M-21 ${top + 12} 0 ${top} 23 ${top + 12} 0 ${top + 24}Z`} fill={variant === 2 ? "#fffdf4" : theme.light} />
        <path d={`M-14 ${top + 27}V-7`} stroke={theme.light} strokeWidth="4" opacity=".5" />
      </g>;
    })}
    {variant === 2 && <path d="M8-75V-5Q8 16 31 18" fill="none" stroke="#a9deed" strokeWidth="10" strokeLinecap="round" />}
  </>;
}

function BalanceRocks({ theme, variant, index }: DecorationProps) {
  return <>
    <path d="M-16 7-22-14-8-32 11-28 22-6 13 7Z" fill={theme.cliff} stroke={theme.darkLeaf} strokeWidth="3" />
    <path d="M-49-34-36-55 33-58 51-42 26-27-23-24Z" fill={theme.leaf} stroke={theme.darkLeaf} strokeWidth="3" />
    <path d="M-33-50 27-52" stroke={theme.light} strokeWidth="6" strokeLinecap="round" />
    {variant === 1 ? <>
      <path d={index % 2 === 0 ? "M-7-55-23-78-8-100 18-92 29-66 13-55Z" : "M-16-55-29-83-9-108 23-87 20-62Z"} fill={theme.accent} stroke="#ad8795" strokeWidth="3" />
      <path d="M-9-88 4-90" stroke="#f9e3bc" strokeWidth="5" strokeLinecap="round" />
    </> : <>
      <path d="M0-57V-102M-58-99H58M-42-98-58-66M-42-98-26-66M42-98 26-66M42-98 58-66" fill="none" stroke={theme.darkLeaf} strokeWidth="4" strokeLinecap="round" />
      <path d="M-62-66Q-42-43-22-66ZM22-66Q42-43 62-66Z" fill={theme.accent} stroke={theme.darkLeaf} strokeWidth="3" />
      <circle cy="-105" r="8" fill={theme.light} stroke={theme.darkLeaf} strokeWidth="3" />
    </>}
  </>;
}

const LANDMARKS = { coast: Lighthouse, mirror: MirrorGarden, orchard: Orchard, pattern: PatternGarden, shapes: Shapes, lagoon: LagoonArch, desert: DesertRuin, canopy: CanopyHouse, cliffs: CliffTowers, balance: BalanceRocks };

function SurfaceDetails({ island, landscape, theme, variant, mobile }: { island: MapIsland; landscape: MapLandscape; theme: Theme; variant: 1 | 2; mobile: boolean }) {
  const main = island.stopIndex !== undefined;
  const x = island.x + (mobile ? -island.rx * .64 : 0);
  const y = island.y + (mobile ? -island.ry * .01 : -island.ry * .39);
  const Landmark = LANDMARKS[landscape];
  const scale = mobile ? .38 : .62;
  return <g data-landmark={main ? landscape : `${landscape}-garden`}>
    {main && <g transform={`translate(${x} ${y}) scale(${scale})`}><Landmark theme={theme} variant={variant} index={island.stopIndex ?? 0} /></g>}
    {landscape === "mirror" && <g fill="none" stroke={theme.light} strokeWidth={mobile ? 2 : 3} opacity=".75">
      <path d={`M${island.x - island.rx * .47} ${island.y + island.ry * .66}q${island.rx * .47} 13 ${island.rx * .94} 0`} />
      <path d={`M${island.x - island.rx * .37} ${island.y + island.ry * .75}q${island.rx * .37} 8 ${island.rx * .74} 0`} />
    </g>}
    {(landscape === "desert" || landscape === "cliffs") && <g fill="none" stroke={theme.light} strokeWidth={mobile ? 2.5 : 4} opacity=".7">
      <path d={`M${island.x - island.rx * .67} ${island.y + island.ry * .57}q${island.rx * .66} ${island.ry * .32} ${island.rx * 1.31} 0`} />
      {variant === 2 && <path d={`M${island.x - island.rx * .51} ${island.y + island.ry * .7}q${island.rx * .48} ${island.ry * .2} ${island.rx} 0`} />}
    </g>}
    {landscape === "pattern" && [-1, 0, 1].map(index => <g key={index} transform={`translate(${island.x + index * island.rx * .33} ${island.y + island.ry * .63})`}>
      {variant === 1 ? <circle r={mobile ? 4 : 6} fill={index === 0 ? theme.accent : theme.light} /> : <path d={mobile ? "M0-5 5 0 0 5-5 0Z" : "M0-7 7 0 0 7-7 0Z"} fill={index === 0 ? theme.accent : theme.light} />}
    </g>)}
    {landscape === "orchard" && <g transform={`translate(${island.x + island.rx * (mobile ? .63 : -.65)} ${island.y + island.ry * .26}) scale(${mobile ? .55 : .8})`}>
      <path d="M-16 0H16L12 17H-12Z" fill="#c09351" stroke="#a37e47" strokeWidth="2" /><path d="M-13 7H13M-4 0V17M5 0V17" stroke="#e7c588" strokeWidth="2" />
      <circle cx="-7" cy="-2" r="6" fill={theme.accent} /><circle cx="5" cy="-4" r="7" fill="#f2c65b" />
    </g>}
    {(landscape === "coast" || landscape === "lagoon") && <g transform={`translate(${island.x + island.rx * .57} ${island.y + island.ry * .52}) scale(${mobile ? .7 : 1})`} fill={theme.light}>
      <path d="M-9 4Q-17-14 0-13Q17-14 9 4Z" stroke={theme.accent} strokeWidth="2" /><path d="M0 3V-9M-3 3-7-8M3 3 7-8" stroke={theme.accent} strokeWidth="1.5" />
    </g>}
    {!main && <g transform={`translate(${island.x - island.rx * .62} ${island.y + island.ry * .04}) scale(${mobile ? .36 : .45})`}>
      {landscape === "coast" ? <Palm theme={theme} /> : landscape === "orchard" ? <FruitTree theme={theme} variant={variant} index={0} /> : <>
        <path d="M-15 6Q-30-15-13-29Q-5-40 4-21Q24-42 31-19Q39 4 20 8Z" fill={theme.leaf} /><path d="M0 6V-17M11 7 22-9" stroke={theme.darkLeaf} strokeWidth="4" strokeLinecap="round" />
        <circle cx="-11" cy="-19" r="5" fill={theme.accent} /><circle cx="25" cy="-12" r="5" fill={theme.light} />
      </>}
    </g>}
  </g>;
}

function Background({ layout, landscape, theme, variant }: { layout: MapLayout; landscape: MapLandscape; theme: Theme; variant: 1 | 2 }) {
  const { width, height } = layout;
  const mobile = width < 500;
  const count = mobile ? 14 : 26;
  return <>
    <path d={`M-30 ${height * .15}Q${width * .22} ${height * .03} ${width * .55} ${height * .18}T${width + 50} ${height * .09}`} fill="none" stroke={theme.light} strokeWidth={mobile ? 32 : 65} opacity=".13" />
    <path d={`M-40 ${height * .78}Q${width * .24} ${height * .97} ${width * .55} ${height * .81}T${width + 50} ${height * .88}`} fill="none" stroke={theme.deep} strokeWidth={mobile ? 40 : 80} opacity=".14" />
    {Array.from({ length: count }, (_, index) => {
      const x = 22 + ((index * 173 + variant * 83) % (width - 44));
      const y = 24 + ((index * 137 + variant * 59) % (height - 48));
      if (landscape === "canopy") return <path key={index} d={`M${x} ${y}q-22-38 14-53q15 28-14 53Z`} fill={theme.darkLeaf} opacity=".11" />;
      if (landscape === "desert") return <path key={index} d={`M${x - 19} ${y}q19-13 39 0m-29 8q15-8 29 0`} fill="none" stroke={theme.light} strokeWidth="2.5" opacity=".36" />;
      if (landscape === "pattern") return <path key={index} d={`M${x} ${y - 8}l7 8-7 8-7-8Z`} fill={theme.light} opacity=".25" />;
      if (landscape === "shapes") return <g key={index} transform={`translate(${x} ${y})`} fill="none" stroke={theme.light} strokeWidth="2" opacity=".3">{index % 2 ? <path d="M-9 8 0-8 9 8Z" /> : <rect x="-7" y="-7" width="14" height="14" rx="2" />}</g>;
      if (landscape === "mirror" || landscape === "balance") return <g key={index} transform={`translate(${x} ${y})`} stroke={theme.light} strokeWidth="2" strokeLinecap="round" opacity=".4"><path d="M-6 0H6M0-6V6" /><circle r="11" fill="none" opacity=".4" /></g>;
      if (landscape === "cliffs") return <path key={index} d={`M${x - 19} ${y}q18-8 38 0q13 5 22 0`} fill="none" stroke={theme.light} strokeWidth="3" strokeLinecap="round" opacity=".35" />;
      return <path key={index} d={`M${x} ${y}q9 6 18 0m9 0q9 6 18 0`} fill="none" stroke={theme.light} strokeWidth="3" strokeLinecap="round" opacity=".45" />;
    })}
    {landscape === "coast" && !mobile && <g transform={`translate(${variant === 1 ? 1075 : 86} 628) scale(.7)`}>
      <ellipse cy="14" rx="45" ry="7" fill={theme.light} opacity=".4" /><path d="M-35 0H35L22 15H-21Z" fill="#fff7dc" /><path d="M0 0V-73M-1-67-31-9H-1ZM6-59 33-9H6Z" fill="#fff0b6" stroke="#5b919a" strokeWidth="3" />
    </g>}
  </>;
}

function Routes({ layout, theme, landscape, completedRoadSlot, mobile, landClipId }: { layout: MapLayout; theme: Theme; landscape: MapLandscape; completedRoadSlot: number; mobile: boolean; landClipId: string }) {
  const wood = landscape === "canopy";
  const line = mobile ? 13 : 20;
  return <g fill="none" strokeLinecap="round" strokeLinejoin="round">
    {layout.storyPaths.map((d, index) => <g key={`story-${index}`} data-story-path="true">
      <path d={d} stroke={theme.deep} strokeWidth={mobile ? 10 : 13} opacity=".24" transform="translate(0 3)" />
      <path d={d} stroke={theme.edge} strokeWidth={mobile ? 7 : 10} strokeDasharray={mobile ? "2 12" : "3 17"} />
    </g>)}
    {layout.roads.map((d, index) => <g key={`road-${index}`} data-map-road={index}>
      <path d={d} stroke={theme.deep} strokeWidth={line + 7} opacity=".25" transform="translate(0 4)" />
      <path data-road-segment={index} d={d} stroke="#8f704c" strokeWidth={line + 6} />
      <path d={d} stroke="#e7c387" strokeWidth={line + 1} />
      <path d={d} stroke="#ad8453" strokeWidth={line + 1} strokeDasharray="2 9" strokeLinecap="butt" />
      {!wood && <g clipPath={`url(#${landClipId})`}>
        <path d={d} stroke="#c29e60" strokeWidth={line + 5} />
        <path d={d} stroke={index < completedRoadSlot ? "#fff1bf" : theme.road} strokeWidth={line + 1} />
        <path d={d} stroke="#fff6dc" strokeWidth="2" strokeDasharray="1 14" opacity=".8" />
      </g>}
    </g>)}
  </g>;
}

/** Decorative SVG and semantic HTML controls consume the same island layout. */
export default function CoastScene(props: CoastSceneProps) {
  if (WORLD_MODE === "prototype") return <LegacyCoastScene {...props} />;
  return <WorldScene {...props} />;
}

function WorldScene({ mobile = false, completedCount = 0, completedRoadSlot = completedCount - 1, worldNumber = 1, className }: CoastSceneProps) {
  const world = getWorldMapLayout(worldNumber);
  const layout = mobile ? world.mobile : world.desktop;
  const theme = THEMES[world.landscape][world.variant - 1];
  const id = useId().replace(/:/g, "");
  const backgroundId = `${id}-landscape`;
  const landClipId = `${id}-land-surfaces`;
  return <svg className={className} data-scene-world={worldNumber} data-landscape={world.landscape} data-landscape-variant={world.variant} viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" height="100%" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={backgroundId} x2=".3" y2="1"><stop stopColor={theme.sky} /><stop offset="1" stopColor={theme.deep} /></linearGradient>
      <clipPath id={landClipId}>{layout.islands.map(island => <path key={island.id} d={SHAPES[island.shape]} transform={`translate(${island.x} ${island.y}) rotate(${island.rotation ?? 0}) scale(${island.rx / 100} ${island.ry / 100})`} />)}</clipPath>
    </defs>
    <rect width={layout.width} height={layout.height} fill={`url(#${backgroundId})`} />
    <Background layout={layout} landscape={world.landscape} theme={theme} variant={world.variant} />
    {layout.islands.map(island => <Land key={island.id} island={island} theme={theme} landscape={world.landscape} mobile={mobile} />)}
    <Routes layout={layout} theme={theme} landscape={world.landscape} completedRoadSlot={completedRoadSlot} mobile={mobile} landClipId={landClipId} />
    {layout.islands.map(island => <SurfaceDetails key={island.id} island={island} landscape={world.landscape} theme={theme} variant={world.variant} mobile={mobile} />)}
  </svg>;
}
