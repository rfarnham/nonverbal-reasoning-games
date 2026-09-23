import { useId } from "react";
import { desktopBonusRoad, desktopRoad, mobileBonusRoad, mobileRoad } from "./map-travel";

type CoastSceneProps = {
  mobile?: boolean;
  completedCount?: number;
  className?: string;
};

type Point = readonly [number, number];

function Tree({ x, y, scale = 1, warm = false }: { x: number; y: number; scale?: number; warm?: boolean }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cy="10" rx="22" ry="8" fill="#137957" opacity=".19" />
    <path d="M-5 9 -4-27 5-27 6 9Z" fill="#a76230" />
    <path d="M0-4 0-26" stroke="#e0a354" strokeWidth="3" strokeLinecap="round" />
    <path d="M-25-24C-32-40-20-57-9-54C-14-75 18-81 24-56C43-54 43-25 27-20C28-5 8-4 1-12C-9-4-25-9-25-24Z" fill={warm ? "#62aa2e" : "#137e5b"} />
    <path d="M-27-30C-32-43-18-58-8-54C-12-74 18-79 23-56C36-55 40-40 30-31C20-34 15-24 3-28C-7-23-17-33-27-30Z" fill={warm ? "#a4d640" : "#29b566"} />
    <path d="M-10-55C-10-63-1-68 6-65" fill="none" stroke={warm ? "#d9ee7d" : "#78d979"} strokeWidth="5" strokeLinecap="round" />
  </g>;
}

function Hill({ x, y, scale = 1, color = "#3bbd67" }: { x: number; y: number; scale?: number; color?: string }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cy="2" rx="39" ry="12" fill="#158458" opacity=".15" />
    <path d="M-38 0V-43C-38-100 36-100 36-43V0C18 12-22 12-38 0Z" fill={color} />
    <path d="M-27-29V-44C-27-62-21-73-10-76" fill="none" stroke="#bcf184" strokeWidth="9" strokeLinecap="round" opacity=".75" />
    <ellipse cx="19" cy="-17" rx="5" ry="8" fill="#16955c" opacity=".32" />
    <ellipse cx="6" cy="-5" rx="4" ry="5" fill="#16955c" opacity=".32" />
  </g>;
}

function Flowers({ x, y, scale = 1, color = "#fff3ba" }: { x: number; y: number; scale?: number; color?: string }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M0 6V-5M13 10V0M-12 9V1" stroke="#368f47" strokeWidth="2.5" strokeLinecap="round" />
    {[[0, -6], [13, -1], [-12, 0]].map(([cx, cy], index) => <g key={index} transform={`translate(${cx} ${cy})`}>
      <path d="M0-2C-7-9-11 1-4 3C-5 11 5 11 5 4C14 1 7-8 2-3Z" fill={color} />
      <circle r="2.4" fill="#f6bb39" />
    </g>)}
  </g>;
}

function Bridge({ from, to, width = 39 }: { from: Point; to: Point; width?: number }) {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI;
  return <g transform={`translate(${from[0]} ${from[1]}) rotate(${angle})`}>
    <rect x="-8" y={-width / 2 + 7} width={length + 16} height={width} rx="8" fill="#157f87" opacity=".24" />
    <rect x="-8" y={-width / 2} width={length + 16} height={width} rx="5" fill="#a96337" />
    {Array.from({ length: Math.ceil(length / 13) + 1 }, (_, index) => <rect key={index} x={index * 13 - 6} y={-width / 2 + 3} width="10" height={width - 6} rx="2" fill="#edbf72" />)}
    <path d={`M-10 ${-width / 2}H${length + 10}M-10 ${width / 2}H${length + 10}`} stroke="#814c2c" strokeWidth="5" strokeLinecap="round" />
    {[0, length].map((x) => <g key={x} fill="#bd7c40" stroke="#7d4e31" strokeWidth="2"><rect x={x - 4} y={-width / 2 - 8} width="8" height="14" rx="2" /><rect x={x - 4} y={width / 2 - 5} width="8" height="14" rx="2" /></g>)}
  </g>;
}

function Lighthouse({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cy="5" rx="43" ry="12" fill="#248052" opacity=".21" />
    <path d="M-30 4-21-85H21L30 4Z" fill="#fff9dd" stroke="#284e56" strokeWidth="3" />
    <path d="M-25-45H25L27-23H-27ZM-21-85H21L23-65H-23Z" fill="#f27960" />
    <path d="M10-83H20L28 2H14Z" fill="#d1d9c3" opacity=".45" />
    <path d="M-8 5V-16C-8-27 8-27 8-16V5" fill="#285168" />
    <rect x="-7" y="-54" width="14" height="17" rx="6" fill="#4aa9ba" stroke="#fff6d9" strokeWidth="3" />
    <rect x="-23" y="-106" width="46" height="23" rx="2" fill="#25556a" />
    <path d="M-15-101H15V-85H-15Z" fill="#ffe18b" />
    <path d="M0-101V-84" stroke="#fff5c9" strokeWidth="4" />
    <path d="M-31-106 0-127 31-106Z" fill="#ea654f" stroke="#ba503e" strokeWidth="3" strokeLinejoin="round" />
    <path d="M-30-81H30M-29-88V-77M29-88V-77" stroke="#315d63" strokeWidth="4" strokeLinecap="round" />
    <path d="M0-128V-149" stroke="#315d63" strokeWidth="3" />
    <path d="M2-149 23-143 2-137Z" fill="#f2be42" />
  </g>;
}

function Cloud({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`} fill="#efffff" opacity=".9">
    <path d="M-39 9C-53 8-55-12-41-17C-43-39-9-44 0-25C17-40 40-27 38-11C63-8 58 17 38 18H-28Z" />
    <path d="M-36 17H32" fill="none" stroke="#bdebec" strokeWidth="5" strokeLinecap="round" />
  </g>;
}

function Boat({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <ellipse cy="18" rx="42" ry="7" fill="#d9ffff" opacity=".35" />
    <path d="M-33 3H33L21 16H-17Z" fill="#fff4d7" />
    <path d="M-33 3H33L28 8H-28Z" fill="#ed7d60" />
    <path d="M0 3V-61" stroke="#376a77" strokeWidth="3" strokeLinecap="round" />
    <path d="M-5-53-30-5H-5Z" fill="#fffbe5" />
    <path d="M5-51 29-8H5Z" fill="#ffd277" />
    <path d="M3-62 18-57 3-52Z" fill="#f47864" />
  </g>;
}

function Island({ d, grass, sand, cliff, scale = 1 }: { d: string; grass: string; sand: string; cliff: string; scale?: number }) {
  return <g>
    <path d={d} fill="none" stroke="#b3f7e4" strokeWidth={31 * scale} opacity=".58" transform={`translate(0 ${11 * scale})`} />
    <path d={d} fill={cliff} stroke={cliff} strokeWidth={13 * scale} transform={`translate(0 ${19 * scale})`} />
    <path d={d} fill={sand} stroke={sand} strokeWidth={15 * scale} transform={`translate(0 ${5 * scale})`} />
    <path d={d} fill={grass} stroke="#dbec80" strokeWidth={3 * scale} />
  </g>;
}

function Road({ segments, completedCount, mobile }: { segments: string[]; completedCount: number; mobile: boolean }) {
  return <g fill="none" strokeLinecap="round" strokeLinejoin="round">
    {segments.map((d, index) => <g key={d}>
      <path d={d} stroke="#468c49" strokeWidth={mobile ? 21 : 28} opacity=".2" transform="translate(0 3)" />
      <path d={d} stroke="#ce9e4d" strokeWidth={mobile ? 18 : 24} />
      <path d={d} stroke={index < completedCount - 1 ? "#ffe39a" : "#f9d377"} strokeWidth={mobile ? 14 : 19} />
      <path d={d} stroke="#fff0b3" strokeWidth="2" strokeDasharray="1 16" opacity=".8" />
    </g>)}
  </g>;
}

/** Original decorative world art. Interactive stops are semantic HTML above it. */
export default function CoastScene({ mobile = false, completedCount = 0, className }: CoastSceneProps) {
  const id = useId().replace(/:/g, "");
  const ocean = `${id}-ocean`;
  const grass = `${id}-grass`;
  const reef = `${id}-reef`;
  const width = mobile ? 400 : 1200;
  const height = mobile ? 960 : 740;
  return <svg className={className} viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={ocean} x2=".35" y2="1"><stop stopColor="#71e0e5" /><stop offset=".55" stopColor="#33c4d4" /><stop offset="1" stopColor="#22accc" /></linearGradient>
      <linearGradient id={grass} x2=".3" y2="1"><stop stopColor="#c8e967" /><stop offset=".5" stopColor="#98d653" /><stop offset="1" stopColor="#75c74d" /></linearGradient>
      <linearGradient id={reef} x2="1" y2="1"><stop stopColor="#8cecdc" /><stop offset="1" stopColor="#46c8c3" /></linearGradient>
    </defs>
    <rect width={width} height={height} fill={`url(#${ocean})`} />
    {mobile ? <MobileScene grass={`url(#${grass})`} reef={`url(#${reef})`} completedCount={completedCount} /> : <DesktopScene grass={`url(#${grass})`} reef={`url(#${reef})`} completedCount={completedCount} />}
  </svg>;
}

function DesktopScene({ grass, reef, completedCount }: { grass: string; reef: string; completedCount: number }) {
  return <>
    <path d="M-30 285C119 146 271 333 437 188S714 46 930 119S1107 53 1240 8V-10H-30Z" fill="#a3eeee" opacity=".25" />
    <path d="M-28 648C162 690 213 603 367 670S650 701 826 614S1075 583 1250 682" fill="none" stroke="#5fd9d7" strokeWidth="70" opacity=".35" />
    <g fill="none" stroke="#c6f8ef" strokeWidth="4" strokeLinecap="round" opacity=".58">
      {[ [75, 300], [90, 672], [193, 113], [398, 259], [522, 691], [658, 604], [757, 107], [837, 680], [1017, 557], [1123, 374], [1150, 612], [402, 92] ].map(([x,y], i) => <path key={i} d={`M${x} ${y}q10 6 20 0m11 0q10 6 20 0`} />)}
    </g>
    <ellipse cx="92" cy="122" rx="73" ry="40" fill={reef} opacity=".7" />
    <Island d="M49 122C48 97 104 86 125 108C151 113 154 140 122 149C99 166 45 151 49 122Z" grass="#a6d76a" sand="#ffe6a2" cliff="#d0a766" scale={.55} />
    <Tree x={91} y={127} scale={.58} />
    <Cloud x={173} y={66} scale={1.05} />
    <Cloud x={758} y={62} scale={.75} />
    <Cloud x={1144} y={308} scale={.7} />

    <Island d="M204 195C196 151 228 126 269 134C307 113 351 145 344 183C366 211 343 248 312 245C278 269 211 249 204 222Z" grass={grass} sand="#ffe2a0" cliff="#c79651" />
    <Island d="M527 160C535 122 577 103 612 119C659 102 702 130 693 164C723 190 688 225 649 220C614 247 548 227 542 207C515 200 511 176 527 160Z" grass={grass} sand="#ffe2a0" cliff="#c79651" />
    <Bridge from={[262, 246]} to={[268, 366]} />
    <Bridge from={[581, 218]} to={[553, 303]} />
    <Bridge from={[459, 508]} to={[501, 421]} width={47} />
    <Bridge from={[955, 296]} to={[953, 226]} width={47} />

    <Island d="M52 450C69 407 158 389 204 377C249 339 319 353 349 405C365 433 351 465 390 480C454 468 491 498 488 555C510 605 466 653 407 651C365 655 336 613 292 617C247 623 222 653 160 636C111 628 79 600 86 571C39 554 17 507 52 450Z" grass={grass} sand="#ffe2a0" cliff="#c79651" />
    <Island d="M496 310C530 270 607 283 649 302C698 256 792 253 839 287C884 264 935 279 959 311C1009 316 1050 363 1030 407C1052 450 1018 478 975 474C931 505 885 469 853 482C810 511 783 547 727 541C671 558 644 516 606 514C552 522 515 481 506 443C460 421 454 351 496 310Z" grass={grass} sand="#ffe2a0" cliff="#c79651" />
    <Island d="M874 120C898 77 948 82 981 94C1020 67 1074 83 1093 104C1140 96 1180 143 1157 183C1172 225 1133 254 1092 246C1063 271 1011 245 979 253C931 268 889 234 897 205C858 190 852 148 874 120Z" grass={grass} sand="#ffe2a0" cliff="#c79651" />

    <g fill="none" stroke="#e2bd78" strokeWidth="3" strokeLinecap="round" opacity=".8">
      <path d="M114 624l9 8m15 7 11 4M381 650l9 7m18 1 10-1M680 547l11 4m20-1 10 1M985 266l13-1m22-5 8 2" />
    </g>
    <g fill="#60b95a" opacity=".32">
      <ellipse cx="155" cy="462" rx="60" ry="27" /><ellipse cx="279" cy="577" rx="40" ry="19" /><ellipse cx="589" cy="326" rx="53" ry="23" /><ellipse cx="862" cy="421" rx="47" ry="26" /><ellipse cx="1033" cy="213" rx="31" ry="13" />
    </g>
    <g fill="none" strokeLinecap="round"><path d={desktopBonusRoad.map(({ path }) => path).join("")} stroke="#ceaa60" strokeWidth="14" /><path d={desktopBonusRoad.map(({ path }) => path).join("")} stroke="#ffe3a3" strokeWidth="9" strokeDasharray="1 14" /></g>
    <Road segments={desktopRoad} completedCount={completedCount} mobile={false} />

    <Hill x={190} y={478} scale={.88} color="#30b967" /><Hill x={136} y={479} scale={.66} color="#56c964" />
    <Tree x={84} y={436} scale={.55} warm /><Tree x={348} y={391} scale={.6} />
    <Tree x={292} y={598} scale={.75} /><Tree x={330} y={613} scale={.55} warm />
    <Flowers x={196} y={596} scale={.85} color="#fff3d7" /><Flowers x={365} y={525} scale={.8} color="#ff9783" />
    <Flowers x={73} y={506} scale={.65} /><Flowers x={459} y={609} scale={.75} color="#fff3d7" />
    <Hill x={620} y={333} scale={.87} color="#55bf61" /><Hill x={668} y={339} scale={.55} color="#32ad60" />
    <Tree x={584} y={468} scale={.66} /><Tree x={612} y={485} scale={.45} warm />
    <Tree x={853} y={461} scale={.8} /><Tree x={888} y={448} scale={.62} warm />
    <Flowers x={748} y={326} scale={.7} color="#f58ba2" /><Flowers x={762} y={506} scale={.6} />
    <Flowers x={922} y={347} scale={.65} /><Flowers x={1010} y={439} scale={.65} color="#fff3d7" />
    <Tree x={327} y={174} scale={.54} /><Flowers x={218} y={212} scale={.55} color="#ff8f83" />
    <Hill x={663} y={155} scale={.44} color="#38b768" /><Flowers x={550} y={170} scale={.5} />
    <Tree x={999} y={113} scale={.52} /><Tree x={1026} y={118} scale={.65} warm />
    <Flowers x={1009} y={218} scale={.6} color="#fff3d7" /><Flowers x={1140} y={205} scale={.6} color="#ff9783" />
    <Lighthouse x={1113} y={118} scale={.69} />
    <Boat x={612} y={654} scale={.82} />
    <g transform="translate(1128 579)" fill="none" stroke="#e0fffa" strokeWidth="3" strokeLinecap="round" opacity=".85"><path d="M-18 0q8-9 16 0m2 0q8-9 16 0M-50 26q6-7 12 0m1 0q6-7 12 0" /></g>
    <Cloud x={31} y={693} scale={1.35} /><Cloud x={1160} y={698} scale={1.6} />
  </>;
}

function MobileScene({ grass, reef, completedCount }: { grass: string; reef: string; completedCount: number }) {
  return <>
    <path d="M-40 101C60 62 200 176 310 109S470 55 440 1H-40ZM-40 484C66 453 241 541 460 468V509C256 580 49 498-40 521Z" fill="#b2f4e9" opacity=".2" />
    <g fill="none" stroke="#c4fbef" strokeWidth="3" strokeLinecap="round" opacity=".65">
      {[[32,196],[346,266],[24,387],[340,444],[24,581],[337,636],[26,749],[325,867],[175,930]].map(([x,y],i) => <path key={i} d={`M${x} ${y}q6 4 12 0m7 0q6 4 12 0`} />)}
    </g>
    <ellipse cx="349" cy="87" rx="40" ry="31" fill={reef} />
    <Island d="M328 79C334 62 363 64 370 79C388 101 353 116 332 100C321 94 320 85 328 79Z" grass="#a8d764" sand="#ffe2a0" cliff="#c79651" scale={.45} />
    <Tree x={348} y={88} scale={.4} />
    <Bridge from={[224, 744]} to={[178, 716]} width={30} />
    <Bridge from={[213, 537]} to={[164, 515]} width={30} />
    <Bridge from={[218, 340]} to={[169, 320]} width={30} />
    <Island d="M77 739C109 715 150 738 174 750C211 728 263 716 298 734C336 740 348 774 324 801C328 833 284 849 250 842C216 859 191 861 167 886C139 919 88 919 63 891C38 874 38 842 60 822C52 797 36 766 77 739Z" grass={grass} sand="#ffe2a0" cliff="#c79651" scale={.65} />
    <Island d="M64 568C89 540 135 563 163 566C196 544 253 541 288 553C326 559 343 590 321 615C328 640 290 658 261 653C216 649 184 675 153 699C119 725 73 710 64 686C38 667 42 640 69 625C46 608 44 587 64 568Z" grass={grass} sand="#ffe2a0" cliff="#c79651" scale={.65} />
    <Island d="M70 373C96 346 136 366 166 372C203 347 261 347 298 360C333 371 342 400 320 422C330 441 320 451 311 458C346 471 338 504 307 509C272 519 257 487 224 481C189 479 172 496 145 509C111 527 68 513 62 488C36 469 40 442 67 427C47 410 44 392 70 373Z" grass={grass} sand="#ffe2a0" cliff="#c79651" scale={.65} />
    <Island d="M153 53C185 34 223 49 227 82C239 118 270 125 297 151C330 168 342 205 315 229C294 252 248 236 221 254C186 268 166 297 133 313C102 331 63 316 59 292C35 275 41 247 67 232C46 214 51 188 71 177C93 151 139 170 156 146C175 126 122 88 153 53Z" grass={grass} sand="#ffe2a0" cliff="#c79651" scale={.65} />
    <Road segments={mobileRoad} completedCount={completedCount} mobile />
    <g fill="none" strokeLinecap="round"><path d={mobileBonusRoad.map(({ path }) => path).join("")} stroke="#c9a35c" strokeWidth="12" /><path d={mobileBonusRoad.map(({ path }) => path).join("")} stroke="#ffe5a8" strokeWidth="7" strokeDasharray="1 12" /></g>
    <Hill x={196} y={796} scale={.44} color="#32ba68" /><Hill x={167} y={800} scale={.34} color="#65c95d" />
    <Tree x={261} y={832} scale={.42} /><Flowers x={68} y={846} scale={.45} color="#fff3d7" />
    <Flowers x={158} y={886} scale={.45} color="#ff9385" />
    <Tree x={234} y={680} scale={.46} /><Tree x={262} y={670} scale={.32} warm />
    <Hill x={149} y={589} scale={.4} /><Flowers x={70} y={615} scale={.43} />
    <Tree x={185} y={647} scale={.33} warm /><Flowers x={295} y={620} scale={.43} color="#ff9488" />
    <Hill x={191} y={422} scale={.43} color="#35b866" /><Hill x={164} y={426} scale={.32} color="#69c960" />
    <Tree x={80} y={395} scale={.39} /><Flowers x={309} y={426} scale={.42} color="#fff3d7" />
    <Tree x={264} y={280} scale={.44} /><Tree x={290} y={269} scale={.32} warm />
    <Hill x={136} y={201} scale={.4} /><Flowers x={74} y={250} scale={.4} color="#fff3d7" />
    <Flowers x={211} y={140} scale={.38} color="#ff9488" />
    <Lighthouse x={223} y={84} scale={.44} />
    <Boat x={335} y={563} scale={.55} /><Boat x={52} y={130} scale={.4} />
    <Cloud x={34} y={43} scale={.7} /><Cloud x={391} y={929} scale={.8} />
    <g transform="translate(334 712)" fill="none" stroke="#e0fffa" strokeWidth="2.5" strokeLinecap="round" opacity=".85"><path d="M-12 0q6-7 12 0m1 0q6-7 12 0M-25 17q4-5 8 0m1 0q4-5 8 0" /></g>
  </>;
}
