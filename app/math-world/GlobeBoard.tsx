"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { canOpenRequiredStop, canOpenWorld, type WorldProgress } from "./engine.ts";
import { BOSS_CHALLENGES, canOpenBoss, type BossChallenge } from "./boss-challenges.ts";
import { QUESTIONS_BY_STOP, WORLD_DEFINITIONS, stopsForWorld, type WorldDefinition } from "./world-data.ts";
import { getWorldMapLayout } from "./map-layouts.ts";
import { GLOBE_DESTINATIONS, getGlobeDestination, getGlobeMap, getGlobeRoadPoints, getVoyageRoute, sampleSurfaceRoute, getSurfaceRouteTangent, sphericalInterpolate, type Vec3 } from "./globe-geometry.ts";
import type { GlobeSceneFrame, GlobeProjection, GlobeScene } from "./globe-scene";
import type { GlobeSkyMode } from "./globe-lighting";
import type { ArchipelagoVoyage, VoyageActivityProps } from "./voyage.ts";
import CoastScene from "./CoastScene";
import { getWorldBiome } from "./globe-biome-data";
import { getSceneryPaused, setSceneryPaused, subscribeSceneryPreference } from "./scenery-preference";
import styles from "./globe.module.css";

type Phase = "overview" | "focused" | "focusing" | "sailing" | "hopping" | "activity";
export type GlobeBoardHandle = { sailTo: (id: string) => void; openStop: (id: string) => void; focus: () => void };
type Props = {
  world: WorldDefinition; boss: BossChallenge | null; progress: WorldProgress; qaUnlocked: boolean;
  restingStopId: string | null; initialOverview: boolean;
  onNavigate: (id: string) => void; onOpenStop: (id: string) => void; onInspectStop: (id: string) => void;
  onBusyChange: (busy: boolean) => void; onStory: (index: number, opener: HTMLButtonElement) => void;
  voyageActivity?: ComponentType<VoyageActivityProps>;
};
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");
const narrowQuery = "(max-width: 620px)";
const subscribeNarrow = (notify: () => void) => {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const readNarrow = () => window.matchMedia(narrowQuery).matches;
const serverNarrow = () => false;
const readReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const ease = (t: number) => t * t * (3 - 2 * t);
let visitSkyMode: GlobeSkyMode = "cycle";
function BookIcon() {
  return <svg viewBox="0 0 48 40" aria-hidden="true" fill="none"><path d="M24 8C17 3 9 3 3 5v28c8-2 14-1 21 3 7-4 13-5 21-3V5c-6-2-14-2-21 3Z" fill="#e3a75c" stroke="#805125" strokeWidth="2"/><path d="M24 8C18 4 11 4 6 6v23c7-1 12 0 18 4 6-4 11-5 18-4V6c-5-2-12-2-18 2Z" fill="#fff8dc"/><path d="M24 8v25M10 12l10 3m-10 3 10 3m8-6 10-3m-10 9 10-3" stroke="#ac8143" strokeWidth="2"/></svg>;
}
const titleFor = (id: string) => WORLD_DEFINITIONS.find(world => world.id === id)?.title ?? BOSS_CHALLENGES.find(boss => boss.id === id)?.title ?? "Your next island";

export const GlobeBoard = forwardRef<GlobeBoardHandle, Props>(function GlobeBoard(props, ref) {
  const [skyMode, setSkyMode] = useState<GlobeSkyMode>(() => visitSkyMode);
  const sceneryPaused = useSyncExternalStore(subscribeSceneryPreference, getSceneryPaused, serverNarrow);
  const reducedScenery = useSyncExternalStore(subscribeSceneryPreference, readReducedMotion, serverNarrow);
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, serverNarrow);
  const destinationId = props.boss?.id ?? props.world.id;
  const selected = getGlobeDestination(destinationId)!;
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; }, [props]);
  const nodes = useRef(new Map<string, HTMLElement>());
  const projectionRef = useRef<GlobeProjection | null>(null);
  const frame = useRef<GlobeSceneFrame>({ focus: selected.center, zoom: props.initialOverview ? 0 : 1, activeDestinationId: destinationId, completedStopIds: props.progress.completedStopIds });
  const [renderer, setRenderer] = useState<"loading" | "webgl" | "fallback">("loading");
  const rendererRef = useRef(renderer);
  useLayoutEffect(() => { rendererRef.current = renderer; }, [renderer]);
  const [phase, setPhase] = useState<Phase>(props.initialOverview ? "overview" : "focused");
  const phaseRef = useRef<Phase>(phase);
  const [voyage, setVoyage] = useState<ArchipelagoVoyage | null>(null);
  const trip = useRef<{ cancel: () => void; skip?: () => void; finishActivity?: () => void } | null>(null);
  const animation = useRef<{ cancel: () => void } | null>(null);
  const motion = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const irisRef = useRef<HTMLDivElement>(null);
  const [activity, setActivity] = useState<ArchipelagoVoyage | null>(null);
  const busy = ["focusing", "sailing", "hopping", "activity"].includes(phase);
  const authoredLayout = getWorldMapLayout(props.world.number, props.world.stopIds.length);
  const layout = renderer === "fallback" && narrow ? authoredLayout.mobile : authoredLayout.desktop;
  const stops = stopsForWorld(props.world.id);
  const currentStop = stops.find(stop => !props.progress.completedStopIds.includes(stop.id));

  function setBoardPhase(next: Phase) { phaseRef.current = next; setPhase(next); }
  function positionMarkers(projection: GlobeProjection | null) {
    if (projection) projectionRef.current = projection;
    if (rendererRef.current === "fallback") {
      const p = latest.current;
      const authored = getWorldMapLayout(p.world.number, p.world.stopIds.length);
      const fallback = readNarrow() ? authored.mobile : authored.desktop;
      for (const [key, node] of nodes.current) {
        const stopIndex = p.world.stopIds.indexOf(key.slice(5));
        const book = fallback.books.find(book => key === `book:${p.world.id}:${book.id}`);
        const point = !p.boss && (key.startsWith("stop:") ? fallback.stopPoints[stopIndex] : book);
        node.style.visibility = point ? "visible" : "hidden";
        node.style.pointerEvents = point ? "auto" : "none";
        node.setAttribute("aria-hidden", String(!point));
        if (point) { node.style.left = `${point.x}%`; node.style.top = `${point.y}%`; }
      }
      return;
    }
    if (!projection) return;
    for (const [key, node] of nodes.current) {
      const isWorld = key.startsWith("world:");
      const group = isWorld ? projection.worlds : key.startsWith("book:") ? projection.books : projection.stops;
      const id = key.slice(key.indexOf(":") + 1);
      const point = group[id];
      const visible = !!point?.visible && (isWorld ? phaseRef.current === "overview" : phaseRef.current === "focused");
      node.style.visibility = visible ? "visible" : "hidden";
      node.style.pointerEvents = visible ? "auto" : "none";
      node.setAttribute("aria-hidden", String(!visible));
      if (point) {
        node.style.left = `${point.x}px`; node.style.top = `${point.y}px`;
        const offset = point.badgeOffset;
        node.dataset.captionSide = point.captionSide ?? "below";
        node.dataset.groundedBadge = String(!!offset && Math.hypot(offset.x, offset.y) > 0);
        if (offset) {
          node.style.setProperty("--stop-stem-length", `${Math.hypot(offset.x, offset.y)}px`);
          node.style.setProperty("--stop-stem-angle", `${-Math.atan2(offset.x, offset.y)}rad`);
        }
      }
    }
  }
  function paint(next: Partial<GlobeSceneFrame> = {}) {
    frame.current = { ...frame.current, ...next, completedStopIds: latest.current.progress.completedStopIds };
    sceneRef.current?.render(frame.current);
  }
  function restingPosition(): Vec3 | undefined {
    const p = latest.current;
    if (p.boss) return undefined;
    const ids = p.world.stopIds;
    const id = p.restingStopId && ids.includes(p.restingStopId) ? p.restingStopId
      : [...ids].reverse().find(id => p.progress.completedStopIds.includes(id)) ?? ids[0];
    const index = ids.indexOf(id);
    return getGlobeMap(p.world.number, ids.length).stops[index]?.point;
  }
  function animate(duration: number, update: (t: number) => void): Promise<boolean> {
    animation.current?.cancel();
    if (motion.current || renderer === "fallback") { update(1); return Promise.resolve(true); }
    return new Promise(resolve => {
      let raf = 0, deadline = 0, ended = false;
      const start = performance.now();
      const finish = (complete: boolean) => {
        if (ended) return; ended = true;
        cancelAnimationFrame(raf); window.clearTimeout(deadline);
        if (complete) update(1);
        animation.current = null; resolve(complete);
      };
      animation.current = { cancel: () => finish(false) };
      const tick = (now: number) => { const t = Math.min(1, (now - start) / duration); update(t); if (t >= 1) finish(true); else raf = requestAnimationFrame(tick); };
      deadline = window.setTimeout(() => finish(true), duration + 1200);
      raf = requestAnimationFrame(tick);
    });
  }
  function cancelTrip() { trip.current?.cancel(); }
  function restoreFocus() { requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus({ preventScroll: true })); }
  function settlePose() {
    const p = latest.current;
    const center = getGlobeDestination(p.boss?.id ?? p.world.id)!.center;
    paint({ focus: center, zoom: 1, activeDestinationId: p.boss?.id ?? p.world.id, boatPosition: undefined, boatHeading: undefined, avatarPosition: restingPosition(), avatarHop: 0 });
    setBoardPhase("focused");
    if (irisRef.current) irisRef.current.style.opacity = "0";
  }
  async function focusRegion() {
    if (trip.current) return false;
    const previous = { ...frame.current };
    const target = getGlobeDestination(latest.current.boss?.id ?? latest.current.world.id)!.center;
    setBoardPhase("focusing");
    const completed = await animate(900, t => paint({ focus: sphericalInterpolate(previous.focus, target, ease(t)), zoom: previous.zoom + (1 - previous.zoom) * ease(t) }));
    if (completed) {
      setBoardPhase("focused"); paint({ avatarPosition: restingPosition() });
      requestAnimationFrame(() => { const first = latest.current.world.stopIds.find(id => canOpenRequiredStop(latest.current.progress, id, latest.current.qaUnlocked)); nodes.current.get(`stop:${first}`)?.focus({ preventScroll: true }); });
    }
    return completed;
  }
  function allowed(id: string) {
    const p = latest.current;
    const boss = BOSS_CHALLENGES.find(boss => boss.id === id);
    return boss ? canOpenBoss(p.progress, boss, p.qaUnlocked) : canOpenWorld(p.progress, id, p.qaUnlocked);
  }
  async function sailTo(id: string) {
    if (trip.current || !allowed(id)) return;
    const p = latest.current;
    const fromId = p.boss?.id ?? p.world.id;
    if (id === fromId) { void focusRegion(); return; }
    const target = getGlobeDestination(id);
    if (!target) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const route = getVoyageRoute(fromId, id);
    const voyageState = { id: `${fromId}:${id}`, fromDestinationId: fromId, toDestinationId: id };
    let active = true;
    const finish = (arrived: boolean) => {
      if (!active) return; active = false;
      animation.current?.cancel(); trip.current?.finishActivity?.(); trip.current = null;
      setVoyage(null); setActivity(null);
      if (arrived && allowed(id)) {
        paint({ focus: target.center, zoom: 1, activeDestinationId: id, boatPosition: undefined, boatHeading: undefined, avatarPosition: undefined });
        setBoardPhase("focused"); latest.current.onNavigate(id);
      } else { settlePose(); restoreFocus(); }
    };
    trip.current = { cancel: () => finish(false), skip: () => finish(true) };
    setVoyage(voyageState); setBoardPhase("sailing");
    if (motion.current || renderer === "fallback") { finish(true); return; }
    const start = { ...frame.current };
    if (!await animate(600, t => paint({ focus: sphericalInterpolate(start.focus, route[0], ease(t)), zoom: start.zoom + (0.38 - start.zoom) * ease(t), avatarPosition: undefined, boatPosition: route[0], boatHeading: getSurfaceRouteTangent(route, 0) }))) return;
    const sail = async (from: number, to: number) => animate(2600 * (to - from), t => {
      const distance = from + (to - from) * ease(t);
      const position = sampleSurfaceRoute(route, distance);
      paint({ focus: position, zoom: 0.38, boatPosition: position, boatHeading: getSurfaceRouteTangent(route, distance) });
    });
    if (!await sail(0, 0.5) || !active) return;
    if (latest.current.voyageActivity) {
      setBoardPhase("activity"); setActivity(voyageState);
      await new Promise<void>(resolve => { if (trip.current) trip.current.finishActivity = resolve; else resolve(); });
      if (!active) return;
      setActivity(null); setBoardPhase("sailing");
    }
    if (!await sail(0.5, 1) || !active) return;
    const end = route.at(-1)!;
    if (!await animate(750, t => paint({ focus: sphericalInterpolate(end, target.center, ease(t)), zoom: 0.38 + 0.62 * ease(t) })) || !active) return;
    finish(true);
  }
  async function openStop(id: string) {
    const p = latest.current;
    if (trip.current || p.boss || !p.world.stopIds.includes(id) || !canOpenRequiredStop(p.progress, id, p.qaUnlocked)) return;
    if (p.progress.completedStopIds.includes(id) && !p.qaUnlocked) { p.onInspectStop(id); return; }
    if (phaseRef.current === "overview" && !await focusRegion()) return;
    if (latest.current.world.id !== p.world.id || latest.current.boss || !canOpenRequiredStop(latest.current.progress, id, latest.current.qaUnlocked)) return;
    if (motion.current || renderer === "fallback") { p.onOpenStop(id); return; }
    const geometry = getGlobeMap(p.world.number, p.world.stopIds.length);
    const targetIndex = p.world.stopIds.indexOf(id);
    const origin = p.restingStopId && p.world.stopIds.includes(p.restingStopId) ? p.world.stopIds.indexOf(p.restingStopId)
      : Math.max(0, p.world.stopIds.findLastIndex(id => p.progress.completedStopIds.includes(id)));
    const points: Vec3[] = [];
    if (origin === targetIndex) points.push(geometry.stops[targetIndex].point);
    else {
      const direction = targetIndex > origin ? 1 : -1;
      for (let index = origin; index !== targetIndex; index += direction) {
        const road = [...getGlobeRoadPoints(p.world.number, p.world.stopIds.length, Math.min(index, index + direction))];
        points.push(...(direction > 0 ? road : road.reverse()));
      }
    }
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let active = true;
    trip.current = { cancel: () => { if (!active) return; active = false; animation.current?.cancel(); trip.current = null; settlePose(); restoreFocus(); } };
    setBoardPhase("hopping");
    if (!await animate(origin === targetIndex ? 400 : 1250, t => paint({ avatarPosition: sampleSurfaceRoute(points, ease(t)), avatarHop: Math.abs(Math.sin(t * Math.PI * (origin === targetIndex ? 1 : 4))) * 0.016 }))) return;
    if (!active) return;
    if (!await animate(300, t => { if (irisRef.current) irisRef.current.style.opacity = String(t); })) return;
    active = false; trip.current = null; setBoardPhase("focused"); p.onOpenStop(id);
  }
  useImperativeHandle(ref, () => ({ sailTo: id => { void sailTo(id); }, openStop: id => { void openStop(id); }, focus: () => { void focusRegion(); } }));

  useEffect(() => {
    let alive = true;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)"); motion.current = query.matches;
    const change = () => { motion.current = query.matches; if (query.matches) { if (trip.current?.skip) trip.current.skip(); else { cancelTrip(); animation.current?.cancel(); settlePose(); } } };
    query.addEventListener("change", change);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { cancelTrip(); if (phaseRef.current === "focusing") { animation.current?.cancel(); settlePose(); } } };
    const onHide = () => { if (document.hidden) cancelTrip(); };
    const onHistory = () => { cancelTrip(); animation.current?.cancel(); settlePose(); };
    const onScroll = () => { if (phaseRef.current === "hopping") cancelTrip(); };
    window.addEventListener("keydown", onKey); window.addEventListener("popstate", onHistory); document.addEventListener("visibilitychange", onHide); window.addEventListener("scroll", onScroll, true);
    const timer = window.setTimeout(() => { if (alive && !sceneRef.current) setRenderer("fallback"); }, 8000);
    void import("./globe-scene").then(({ createGlobeScene }) => {
      if (!alive || !canvasRef.current) return;
      const scene = createGlobeScene(canvasRef.current, { assetBasePath: basePath, animateScenery: !getSceneryPaused(), onProject: positionMarkers, onUnavailable: () => { if (alive) { setRenderer("fallback"); cancelTrip(); animation.current?.cancel(); settlePose(); } } });
      if (!alive) { scene.dispose(); return; }
      sceneRef.current = scene; scene.setSkyMode(visitSkyMode); setRenderer("webgl"); paint({ avatarPosition: restingPosition() });
    }).catch(() => { if (alive) setRenderer("fallback"); });
    return () => {
      alive = false; window.clearTimeout(timer); trip.current?.finishActivity?.(); cancelTrip(); animation.current?.cancel(); sceneRef.current?.dispose(); sceneRef.current = null;
      query.removeEventListener("change", change); window.removeEventListener("keydown", onKey); window.removeEventListener("popstate", onHistory); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("scroll", onScroll, true);
    };
    // The scene is owned by this mount; current props are read through latest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { sceneRef.current?.setSceneryMotion(!sceneryPaused); }, [sceneryPaused]);
  const onBusyChange = props.onBusyChange;
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (trip.current) cancelTrip();
    animation.current?.cancel();
    paint({ focus: getGlobeDestination(destinationId)!.center, activeDestinationId: destinationId, avatarPosition: restingPosition() });
  }, [destinationId]);
  useEffect(() => { paint({ avatarPosition: trip.current ? frame.current.avatarPosition : restingPosition() }); }, [props.progress, props.restingStopId]);
  useEffect(() => { positionMarkers(projectionRef.current); }, [phase, destinationId, renderer, narrow]);
  function turn(dx: number, dy: number) {
    if (busy) return;
    const focus = frame.current.focus;
    const longitude = Math.atan2(focus.x, focus.z) + dx;
    const latitude = Math.max(-1.35, Math.min(1.35, Math.asin(focus.y) + dy));
    paint({ focus: { x: Math.cos(latitude) * Math.sin(longitude), y: Math.sin(latitude), z: Math.cos(latitude) * Math.cos(longitude) }, zoom: 0 });
  }
  const VoyageActivity = props.voyageActivity;
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return <section className={styles.boardSection} aria-label={`${titleFor(destinationId)} globe map`}>
    <div className={styles.boardToolbar}>
      <span className={styles.boardEyebrow}>{phase === "overview" ? "A world of discoveries" : props.boss ? "Challenge islands" : getWorldBiome(props.world.number).label}</span>
      <div className={styles.sceneryControls}>
      {renderer === "webgl" && <label className={styles.skyControl}>Sky
        <select aria-label="Time of day" value={skyMode} onChange={event => {
          const mode = event.target.value as GlobeSkyMode; visitSkyMode = mode; setSkyMode(mode); sceneRef.current?.setSkyMode(mode);
        }}><option value="cycle">Auto</option><option value="day">Day</option><option value="sunset">Sunset</option><option value="night">Night</option></select>
      </label>}
      {renderer === "webgl" && <button type="button" className={styles.sceneryToggle} aria-pressed={sceneryPaused} disabled={reducedScenery}
        title={reducedScenery ? "Scenery stays still with reduced motion" : undefined}
        onClick={() => setSceneryPaused(!sceneryPaused)}>{sceneryPaused ? "Scenery paused" : "Pause scenery"}</button>}
      <button type="button" disabled={busy || renderer !== "webgl"} onClick={() => {
        if (phase === "overview") { void focusRegion(); return; }
        const start = frame.current.zoom; setBoardPhase("focusing");
        void animate(650, t => paint({ zoom: start * (1 - ease(t)), avatarPosition: undefined })).then(done => { if (done) { setBoardPhase("overview"); paint(); } });
      }}>{phase === "overview" ? `Explore ${titleFor(destinationId)}` : "Show globe"} <span aria-hidden="true">{phase === "overview" ? "↘" : "◎"}</span></button>
      </div>
    </div>
    <div ref={boardRef} className={styles.board} data-globe-phase={phase} data-globe-renderer={renderer} data-voyage-from={voyage?.fromDestinationId} data-voyage-to={voyage?.toDestinationId} aria-busy={busy}
      onPointerDown={event => { if (phase !== "overview" || (event.target as HTMLElement).closest("button")) return; pointer.current = { x: event.clientX, y: event.clientY, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { const p = pointer.current; if (!p) return; const dx = event.clientX - p.x, dy = event.clientY - p.y; if (Math.hypot(dx, dy) > 2) p.moved = true; turn(-dx * 0.006, dy * 0.006); p.x = event.clientX; p.y = event.clientY; }}
      onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }}>
      <div ref={canvasRef} className={styles.canvas} data-globe-canvas aria-hidden="true" />
      {renderer === "loading" && <div className={styles.loading} role="status"><span>◎</span>Opening your globe…</div>}
      {renderer === "fallback" && !props.boss && <CoastScene mobile={narrow} className={styles.fallbackMap} completedRoadSlot={-1} worldNumber={props.world.number} />}
      {renderer === "fallback" && props.boss && <div className={styles.loading}>♜</div>}
      <div className={styles.markerLayer}>
        {GLOBE_DESTINATIONS.map(destination => {
          const boss = BOSS_CHALLENGES.find(boss => boss.id === destination.id);
          const available = boss ? canOpenBoss(props.progress, boss, props.qaUnlocked) : canOpenWorld(props.progress, destination.id, props.qaUnlocked);
          const world = WORLD_DEFINITIONS.find(world => world.id === destination.id);
          return <button type="button" key={destination.id} ref={node => { if (node) nodes.current.set(`world:${destination.id}`, node); else nodes.current.delete(`world:${destination.id}`); }}
            className={`${styles.worldPin} ${destination.id === destinationId ? styles.selectedPin : ""}`} style={{ visibility: "hidden" }}
            data-globe-destination={destination.id} disabled={!available || busy || renderer !== "webgl"} aria-label={`${titleFor(destination.id)}. ${available ? "Sail here" : "Locked"}.`} onClick={() => { void sailTo(destination.id); }}>
            <span>{world?.number ?? "★"}</span>{!available && <small aria-hidden="true">⌑</small>}
          </button>;
        })}
        {!props.boss && stops.map((stop, index) => {
          const complete = props.progress.completedStopIds.includes(stop.id);
          const available = canOpenRequiredStop(props.progress, stop.id, props.qaUnlocked);
          const fallback = renderer === "fallback";
          const point = layout.stopPoints[index];
          return <button type="button" key={stop.id} ref={node => { if (node) nodes.current.set(`stop:${stop.id}`, node); else nodes.current.delete(`stop:${stop.id}`); }}
            className={`${styles.stopPin} ${complete ? styles.completePin : currentStop?.id === stop.id ? styles.currentPin : ""}`}
            style={fallback ? { left: `${point.x}%`, top: `${point.y}%`, visibility: "visible" } : { visibility: "hidden" }}
            data-stop-id={stop.id} disabled={!available || busy} aria-current={currentStop?.id === stop.id ? "step" : undefined}
            aria-label={`${stop.label}. ${complete ? "Completed" : available ? "Available" : "Locked"}. ${QUESTIONS_BY_STOP.get(stop.id)?.length} questions.`} onClick={() => { void openStop(stop.id); }}>
            <span>{complete ? "✓" : !available ? "⌑" : stop.kind === "culmination" ? "★" : index + 1}</span><small>{stop.shortLabel}</small>
          </button>;
        })}
        {!props.boss && layout.books.map((book, index) => <button type="button" key={`${props.world.id}:${book.id}`} ref={node => { const key = `book:${props.world.id}:${book.id}`; if (node) nodes.current.set(key, node); else nodes.current.delete(key); }}
          className={styles.bookPin} disabled={busy} data-story-island-id={book.islandId} data-story-book-id={book.id}
          style={renderer === "fallback" ? { left: `${book.x}%`, top: `${book.y}%`, visibility: "visible" } : { visibility: "hidden" }}
          aria-label={`Storybook on island ${index + 1}: coming soon`} aria-haspopup="dialog" onClick={event => props.onStory(index, event.currentTarget)}><BookIcon /></button>)}
      </div>
      {phase === "overview" && renderer === "webgl" && <div className={styles.orbitControls} aria-label="Turn the globe">
        <button type="button" aria-label="Turn globe left" onClick={() => turn(-0.45, 0)}>←</button>
        <button type="button" aria-label="Turn globe up" onClick={() => turn(0, 0.35)}>↑</button>
        <button type="button" aria-label="Turn globe down" onClick={() => turn(0, -0.35)}>↓</button>
        <button type="button" aria-label="Turn globe right" onClick={() => turn(0.45, 0)}>→</button>
      </div>}
      {voyage && <div className={styles.voyageCard} role="status"><span className={styles.voyageKicker}>ALL ABOARD</span><strong>Sailing to {titleFor(voyage.toDestinationId)}</strong><div><button type="button" onClick={() => trip.current?.skip?.()}>Skip voyage</button><button type="button" onClick={cancelTrip}>Cancel voyage</button></div></div>}
      {activity && VoyageActivity && <div className={styles.activity}><VoyageActivity voyage={activity} onContinue={() => trip.current?.finishActivity?.()} onCancel={cancelTrip} /></div>}
      <div ref={irisRef} className={styles.iris} aria-hidden="true" />
    </div>
    <p className={styles.boardCaption}>{renderer === "fallback" ? "Choose an island stop, or use the list below." : phase === "overview" ? "Drag to turn the globe. Choose an archipelago to set sail." : props.boss ? "A new challenge waits on the horizon." : "Choose a stop to explore. The two books hold stories to come."}</p>
  </section>;
});
