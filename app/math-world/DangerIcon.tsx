import type { GlobeDangerKind } from "./globe-danger-locations.ts";

/** Compact map symbols, drawn in the same coordinate space for equal targets. */
export function DangerIcon({ kind }: { kind: GlobeDangerKind }) {
  return <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "squall" ? <><path d="M7 17a5 5 0 0 1 0-10 7 7 0 0 1 13-1 5.5 5.5 0 1 1 5 11H7Z" fill="currentColor" opacity=".5"/><path d="m17 13-6 8h6l-3 8 9-12h-7l3-4M3 22h4m16 3h6"/></>
      : kind === "kraken" ? <><path d="M10 16V10a6 6 0 0 1 12 0v6M10 16c-6 1-9 8-4 9 4 1 5-5 7-6m0 0c-1 7 0 11 3 10 3-1 2-6 1-9m0 0c6 8 10 7 10 3 0-4-6-3-7-6M10 14h12"/><circle cx="14" cy="11" r=".8" fill="currentColor"/><circle cx="19" cy="11" r=".8" fill="currentColor"/></>
      : kind === "maelstrom" ? <><path d="M27 14C23 3 6 5 4 15c-2 10 20 14 23 3 2-8-16-13-19-3-2 6 13 10 15 3 1-5-10-8-12-2-1 3 6 6 8 2"/></>
      : kind === "fog" ? <><path d="M3 10h18m3 0h5M7 16h22M3 22h17m4 0h4M11 5h8M9 27h17"/><path d="m3 16 1 0"/></>
      : kind === "icebergs" ? <><path d="m4 21 6-16 5 5 3 10 5-11 6 12M2 24c5-3 7 3 12 0s8 3 16 0M10 5l1 14m12-10-1 11"/><path d="m6 26 5 4 4-4m8 0 3 3 2-3" opacity=".55"/></>
      : <><path d="M3 26h26M8 25V13m0 7-5-5m5 2 5-7m-5 4L5 8m8 17v-7m0 3 4-3m6 7V10m0 8 6-4m-6 0-4-7m4 5 4-5"/><path d="M3 5c4-2 7 2 11 0m8-1h7" opacity=".6"/></>}
  </svg>;
}
