import type { SVGProps } from "react";
import { PICTURE_BY_ID, type PictureId } from "./picture-data";

const ink = "#17213d";
const paper = "#fffdf8";
const coral = "#f06f5f";
const gold = "#f3bd4e";
const teal = "#35a999";
const violet = "#7767d7";

/** A fixed drawing box keeps study pictures and recall choices the same size.
 * Parents own accessible task/choice names, so duplicate SVG detail is hidden. */
export function Picture({ id, ...props }: Omit<SVGProps<SVGSVGElement>, "id"> & { id: PictureId }) {
  const { family, variant } = PICTURE_BY_ID[id];
  const second = variant === 2;
  let drawing;

  switch (family) {
    case "apple":
      drawing = <>
        <path d={second ? "M60 38C48 24 20 33 19 56c-2 24 13 45 29 43 8-2 15-2 24 0 12 1 24-12 28-28-11 2-18-5-17-14 1-8 8-14 16-13C91 28 70 25 60 38Z" : "M60 38C48 24 20 33 19 56c-2 24 13 45 29 43 8-2 15-2 24 0 15 2 30-20 29-43-1-23-29-32-41-18Z"} fill={coral} />
        <path d="M60 38V21" fill="none" />
        <path d="M62 27c2-13 14-18 27-14-3 13-14 17-27 14Z" fill={teal} />
      </>;
      break;
    case "pear": {
      const pear = <><path d="M53 27c-16 0-11 20-24 32-25 25-12 47 18 47s41-22 18-47C54 47 69 27 53 27Z" fill={gold} /><path d="M53 28l4-15" fill="none" /><path d="M58 24c6-12 18-11 23-7-4 9-13 13-23 7Z" fill={teal} /></>;
      drawing = second ? <><g transform="translate(0 13) scale(.76)">{pear}</g><g transform="translate(41 -1) scale(.86)">{pear}</g></> : <g transform="translate(10 -2)">{pear}</g>;
      break;
    }
    case "fish":
      drawing = <>
        <path d={second ? "M39 60 13 34l4 26-4 26 26-26Z" : "M39 60C15 27 4 41 12 60 4 79 15 93 39 60Z"} fill={coral} />
        <path d="M52 41 62 24l16 20M52 80l13 14 12-17" fill={gold} />
        <path d="M32 60c18-31 53-31 76 0-23 31-58 31-76 0Z" fill={teal} />
        <path d="m62 58-12 9 15 4" fill={gold} /><circle cx="90" cy="54" r="3.5" fill={ink} stroke="none" />
      </>;
      break;
    case "bird":
      drawing = <>
        {second && <path d="M55 57C26 53 15 30 18 15c23 2 37 17 44 37 11-21 27-32 45-31-2 21-16 35-36 41Z" fill={teal} />}
        <path d="M41 73 16 58l3 28 30 1" fill={teal} />
        <path d="M43 58c3-17 17-24 31-21 13 2 20 13 17 24-3 24-20 36-39 29-15-5-21-20-9-32Z" fill={gold} />
        {!second && <path d="M47 66c7-11 19-13 30-7-6 15-16 22-30 7Z" fill={teal} />}
        <path d="m90 51 18 8-18 6" fill={coral} /><circle cx="78" cy="50" r="3" fill={ink} stroke="none" /><path d="m53 91-3 13m18-11 2 11" />
      </>;
      break;
    case "rabbit":
      drawing = <>
        {second ? <><path d="M48 50C22 20 9 29 17 48c5 12 18 15 33 16M70 49C93 20 109 30 100 49c-5 12-19 14-30 15" fill={paper} /></> : <><ellipse cx="45" cy="35" rx="12" ry="27" fill={paper} transform="rotate(-9 45 35)" /><ellipse cx="75" cy="35" rx="12" ry="27" fill={paper} transform="rotate(9 75 35)" /><path d="m45 23 2 19m28-19-2 19" stroke={coral} /></>}
        <ellipse cx="60" cy="78" rx="34" ry="28" fill={paper} /><circle cx="48" cy="73" r="3.5" fill={ink} stroke="none" /><circle cx="72" cy="73" r="3.5" fill={ink} stroke="none" /><path d="m55 84 5 5 5-5Z" fill={coral} /><path d="M60 89v6m0 0c-6 5-10 1-10 1m10-1c6 5 10 1 10 1M35 84l-17-3m17 11-17 3m67-11 17-3M85 92l17 3" fill="none" />
      </>;
      break;
    case "key":
      drawing = <g transform="rotate(-35 60 60)"><path d="M53 47h15v54H53Z" fill={gold} /><path d={second ? "M64 72h22v12H69v11h17v12H54V72Z" : "M63 88h23v19H54V88Z"} fill={gold} /><circle cx="60" cy="34" r="24" fill={gold} /><circle cx="60" cy="34" r="10" fill={paper} /></g>;
      break;
    case "umbrella":
      drawing = <>
        <path d="M60 25v64c0 22-24 22-24 4" fill="none" />
        {second ? <><path d="m59 16-17 58 18-7 18 7-17-58Z" fill={violet} /><path d="M60 20v44" fill="none" /></> : <><path d="M12 62c3-31 23-44 48-44s45 13 48 44c-8-9-16-9-24 0-8-9-16-9-24 0-8-9-16-9-24 0-8-9-16-9-24 0Z" fill={violet} /><path d="M60 19c-17 13-24 27-24 42m24-42c17 13 24 27 24 42" fill="none" /></>}
      </>;
      break;
    case "rocket":
      drawing = <>
        <path d="m45 88 15 25 15-25" fill={gold} />
        <path d="M44 58 24 75v23l25-13m27-27 20 17v23L71 85" fill={coral} />
        {second && <><path d="M21 45c-9 10-10 26-5 43h16c5-17 4-33-5-43Z" fill={teal} /><path d="M93 45c-9 10-10 26-5 43h16c5-17 4-33-5-43Z" fill={teal} /></>}
        <path d="M60 10C40 25 36 57 43 86h34c7-29 3-61-17-76Z" fill={paper} /><path d="M60 10c-8 6-13 14-17 25h34c-4-11-9-19-17-25Z" fill={coral} /><circle cx="60" cy="56" r="11" fill={teal} />
      </>;
      break;
    case "kite":
      drawing = <>
        <path d="M63 77c-9 14-22 12-23 24 0 7 7 9 15 8" fill="none" />
        <path d={second ? "M60 12 18 78l42-18 42 18Z" : "M60 10 24 42l36 42 36-42Z"} fill={coral} />
        {second ? <path d="M60 12v48m-1 0L34 53m26 7 26-7" fill="none" /> : <path d="M60 10v73M24 42h72" fill="none" />}
        <path d="m46 88-13-7v14Zm1 13 14-6v14Z" fill={gold} />
      </>;
      break;
    case "balloon":
      drawing = second ? <><path d="m30 64 30 43 30-43M60 70v37" fill="none" /><ellipse cx="30" cy="40" rx="23" ry="29" fill={coral} /><path d="m26 68 4-6 4 6" fill={coral} /><ellipse cx="90" cy="40" rx="23" ry="29" fill={coral} /><path d="m86 68 4-6 4 6" fill={coral} /><ellipse cx="60" cy="50" rx="23" ry="29" fill={coral} /><path d="m56 78 4-6 4 6" fill={coral} /></> : <><path d="M60 82c-13 13 10 19-1 29" fill="none" /><ellipse cx="60" cy="44" rx="32" ry="37" fill={coral} /><path d="m54 85 6-8 6 8Z" fill={coral} /></>;
      break;
    case "boat":
      drawing = <>
        <path d="M61 15v73" fill="none" /><path d="M56 20 20 73h36Z" fill={gold} />
        {second && <path d="M67 32v41h33Z" fill={coral} />}
        <path d="m13 84 16 19h62l17-19Z" fill={teal} /><path d="M11 110c8-7 15-7 23 0 8-7 15-7 23 0 8-7 15-7 23 0 8-7 15-7 23 0" fill="none" />
      </>;
      break;
    case "leaf":
      drawing = <>
        <path d={second ? "M30 94c-20-7-19-20 0-25-24-15-14-34 7-26-10-29 12-38 24-16 20-28 36-15 23 11 31-3 30 18 3 30 21 12 12 28-10 23-14 15-29 15-47 3Z" : "M24 93C7 52 43 18 104 14c-2 59-31 97-80 79Z"} fill={teal} />
        <path d="m17 105 63-64M39 82l-6-23m20 9 24 1m-12-16-2-22" fill="none" />
      </>;
      break;
    case "flower":
      drawing = <>
        <path d="M60 53v55" fill="none" /><path d="M59 91c-26 1-30-14-26-22 18 0 27 9 26 22Zm3 5c24-2 28-17 23-24-17 1-25 11-23 24Z" fill={teal} />
        {second ? <path d="M30 21 45 36l15-22 15 22 15-15v24c0 18-13 28-30 28S30 63 30 45Z" fill={coral} /> : <><circle cx="60" cy="23" r="16" fill={coral} /><circle cx="83" cy="40" r="16" fill={coral} /><circle cx="75" cy="65" r="16" fill={coral} /><circle cx="45" cy="65" r="16" fill={coral} /><circle cx="37" cy="40" r="16" fill={coral} /><circle cx="60" cy="45" r="16" fill={gold} /></>}
      </>;
      break;
    case "teapot":
      drawing = <>
        <path d="M82 49c32-15 34 32 4 34" fill="none" strokeWidth="9" />
        <path d="m36 51-22-9 4 21 21 14" fill={teal} />
        {second ? <path d="M37 34h45l7 60H30Z" fill={teal} /> : <ellipse cx="60" cy="69" rx="34" ry="27" fill={teal} />}
        <path d={second ? "M32 34h55l-9-11H41Z" : "M34 47h52l-9-12H43Z"} fill={gold} /><path d={second ? "M60 23v-9" : "M60 35v-9"} fill="none" /><path d="M32 98h56" fill="none" />
      </>;
      break;
    case "mug":
      drawing = <>
        {second && <><path d="m65 59 19-38" fill="none" strokeWidth="7" /><ellipse cx="88" cy="17" rx="8" ry="14" transform="rotate(26 88 17)" fill={gold} /></>}
        <path d="M82 47h9c27 0 27 35 0 35H80" fill="none" strokeWidth="9" /><path d="M24 39h61v47c0 13-11 19-30 19S24 99 24 86Z" fill={coral} /><path d="M24 39h61" fill="none" /><path d="M32 112h58" fill="none" />
      </>;
      break;
    case "boot":
      drawing = <>
        <path d={second ? "M36 12h39v65l22 8c11 3 14 11 10 20H24V88l12-5Z" : "M36 48h39v29l22 8c11 3 14 11 10 20H24V88l12-5Z"} fill={gold} /><path d={second ? "M36 23h39" : "M36 58h39"} fill="none" /><path d="M24 105h83v9H24Z" fill={ink} /><path d="M59 68h16m-16 11h16" fill="none" />
      </>;
      break;
    case "guitar":
      drawing = <g transform="rotate(27 60 60)">
        <path d="M54 13h12v51H54Z" fill={gold} /><path d="M50 8h20v20H50Z" fill={teal} /><path d={second ? "M42 51 29 39v27c-18 9-15 34 2 42 20 10 42-1 46-15 3-11-3-22-8-25V44L59 60Z" : "M44 53c-15 0-20 14-13 27-23 14-13 38 9 38h20c22 0 32-24 9-38 7-13 2-27-13-27Z"} fill={coral} />
        {second ? <><path d="M42 77h18v8H42Zm-1 17h21" fill={ink} /></> : <circle cx="50" cy="78" r="12" fill={ink} />}
        <path d="M48 31v69m6-69v69m-15 1h23" fill="none" strokeWidth="2" />
      </g>;
      break;
    case "clock":
      drawing = <>
        {second ? <rect x="16" y="16" width="88" height="88" rx="12" fill={gold} /> : <circle cx="60" cy="60" r="46" fill={gold} />}
        <circle cx="60" cy="60" r="35" fill={paper} /><path d="M60 32v7m28 21h-7M60 88v-7M32 60h7M60 60V45m0 15 16 10" fill="none" /><circle cx="60" cy="60" r="3" fill={ink} />
      </>;
      break;
    case "shell":
      drawing = second ? <><path d="M102 80c-13 34-68 38-84 4C2 51 23 17 56 17c26 0 46 21 43 46-3 24-27 33-45 23-16-8-20-30-8-41 10-9 28-6 32 7 4 11-5 21-15 18" fill={gold} /><path d="M102 80c-8 4-13 9-15 16" fill="none" /></> : <><path d="M47 103 13 50c-8-17 7-29 20-21 0-20 23-26 30-10 12-16 32-5 29 12 19-5 29 14 17 28L73 103Z" fill={gold} /><path d="m60 96-4-67m-5 67L31 40m37 56 15-53m-10 53 26-41" fill="none" /><path d="M46 96h29v14H46Z" fill={coral} /></>;
      break;
    case "camera":
      drawing = <>
        {second && <><path d="M89 42V23" fill="none" strokeWidth="7" /><path d="M73 9h33v21H73Z" fill={gold} /></>}
        <path d="m33 37 8-14h27l8 14" fill={teal} /><rect x="12" y="37" width="96" height="65" rx="9" fill={teal} /><circle cx="60" cy="70" r="24" fill={paper} /><circle cx="60" cy="70" r="14" fill={violet} /><path d="M22 49h11" fill="none" />
      </>;
      break;
    case "lantern":
      drawing = <>
        <path d="M40 28v-6c0-22 40-22 40 0v6" fill="none" />
        {second ? <ellipse cx="60" cy="67" rx="36" ry="38" fill={gold} /> : <rect x="31" y="31" width="58" height="70" rx="4" fill={gold} />}
        <path d="M45 36v59m30-59v59M29 30h62M29 103h62M44 110h32" fill="none" /><path d="M60 54c-12 13-13 26 0 29 13-3 12-16 0-29Z" fill={coral} />
      </>;
      break;
    case "bicycle":
      drawing = <>
        <circle cx="27" cy="84" r="21" fill={paper} /><circle cx="94" cy="84" r="21" fill={paper} /><path d="m27 84 22-37 16 37H27l47-30 20 30M70 37h13l-6 17M40 47h18" fill="none" stroke={teal} strokeWidth="5" /><circle cx="65" cy="84" r="5" fill={gold} /><path d="m65 84 10 7" fill="none" />
        {second && <path d="m82 35 2 23h25l4-23Z" fill={gold} />}
      </>;
      break;
    case "book":
      drawing = second ? <><path d="M60 34C45 22 27 21 10 26v69c18-4 35-3 50 8 15-11 32-12 50-8V26c-17-5-35-4-50 8Z" fill={teal} /><path d="M60 34v69M21 42c11-2 21 0 29 5m-29 9c11-2 21 0 29 5m20-14c8-5 18-7 29-5m-29 19c8-5 18-7 29-5" fill="none" /></> : <><path d="M26 17h70v90H26c-16 0-16-19 0-19V17Z" fill={teal} /><path d="M26 88h70v19H26c-16 0-16-19 0-19Z" fill={paper} /><path d="M26 17v71" fill="none" /><path d="M43 36h36m-36 14h26" fill="none" stroke={paper} /></>;
      break;
    case "hat":
      drawing = second ? <><path d="M22 78V62c0-46 69-46 69 0v16Z" fill={violet} /><path d="M59 78h32c30 0 28 20 5 20-16 0-29-7-37-20Z" fill={gold} /><path d="M22 78h69M58 26c-12 17-16 33-13 52" fill="none" /></> : <><path d="M29 79 37 28h47l9 51" fill={violet} /><path d="M32 60h57v19H32Z" fill={gold} /><ellipse cx="60" cy="85" rx="50" ry="15" fill={violet} /></>;
      break;
  }

  return <svg viewBox="0 0 120 120" fill="none" stroke={ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{drawing}</svg>;
}
