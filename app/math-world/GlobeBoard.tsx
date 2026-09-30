"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { canOpenRequiredStop, canOpenWorld, type WorldProgress } from "./engine.ts";
import { BOSS_CHALLENGES, canOpenBoss, type BossChallenge } from "./boss-challenges.ts";
import { QUESTIONS_BY_STOP, WORLD_DEFINITIONS, stopsForWorld, type WorldDefinition } from "./world-data.ts";
import { getWorldMapLayout } from "./map-layouts.ts";
import { GLOBE_DESTINATIONS, GLOBE_DANGER_REGIONS, getGlobeDestination, getGlobeMap, getGlobeRoadPoints, getVoyageRoute, sampleSurfaceRoute, getSurfaceRouteTangent, getSurfaceRouteLength, sphericalInterpolate, type Vec3 } from "./globe-geometry.ts";
import { advanceGlobeAnimationTime, globeTransitionDuration, globeOrientationFocus, interpolateGlobeOrientation, northUpGlobeOrientation, transportGlobeOrientation, turnGlobeOrientation, voyageProgress } from "./globe-navigation.ts";
import type { GlobeSceneFrame, GlobeProjection, GlobeScene } from "./globe-scene";
import type { GlobeSkyMode } from "./globe-lighting";
import type { ArchipelagoVoyage, VoyageActivityProps } from "./voyage.ts";
import CoastScene from "./CoastScene";
import { getBossStormStages, bossStormStageLabel } from "./boss-storm-state.ts";
import { CalmPassageArtwork } from "./CalmPassageArtwork";
import { DangerIcon } from "./DangerIcon";
import { StormArtwork, StormIcon } from "./StormArtwork";
import { getWorldBiome } from "./globe-biome-data";
import { getSceneryPaused, setSceneryPaused, subscribeSceneryPreference } from "./scenery-preference";
import { createSceneryClock } from "./scenery-clock";
import { CrystalFallStill } from "./CrystalFallStill";
import { dangerById, type DangerDefinition } from "./danger-definitions.ts";
import { DANGER_STORIES } from "./danger-content.ts";
import Image from "next/image";
import styles from "./globe.module.css";

type Phase = "overview" | "focused" | "focusing" | "sailing" | "hopping" | "activity" | "story";
export type GlobeBoardHandle = { sailTo: (id: string) => void; openStop: (id: string) => void; focus: () => void };
type Props = {
  danger?: DangerDefinition | null; dangerStages?: Record<string, number>; canNavigate?: (id: string) => boolean;
  onOpenDanger?: () => void; dangerReady?: boolean; dangerComplete?: boolean;
  world: WorldDefinition; boss: BossChallenge | null; progress: WorldProgress; qaUnlocked: boolean;
  restingStopId: string | null; initialOverview: boolean;
  onNavigate: (id: string) => void; onOpenStop: (id: string) => void; onInspectStop: (id: string) => void;
  onBusyChange: (busy: boolean) => void; onStory: (index: number, opener: HTMLButtonElement) => void;
  voyageActivity?: ComponentType<VoyageActivityProps>;
  interactionLocked?: boolean; storyScene?: boolean; storyScattered?: boolean;
  onStorySceneEnd?: () => void; storyBookLabels?: readonly string[];
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
const titleFor = (id: string) => WORLD_DEFINITIONS.find(world => world.id === id)?.title ?? BOSS_CHALLENGES.find(boss => boss.id === id)?.title ?? dangerById(id)?.title ?? "Your next island";

export const GlobeBoard = forwardRef<GlobeBoardHandle, Props>(function GlobeBoard(props, ref) {
  const [skyMode, setSkyMode] = useState<GlobeSkyMode>(() => visitSkyMode);
  const sceneryPaused = useSyncExternalStore(subscribeSceneryPreference, getSceneryPaused, serverNarrow);
  const reducedScenery = useSyncExternalStore(subscribeSceneryPreference, readReducedMotion, serverNarrow);
  const narrow = useSyncExternalStore(subscribeNarrow, readNarrow, serverNarrow);
  const destinationId = props.danger?.id ?? props.boss?.id ?? props.world.id;
  const selected = getGlobeDestination(destinationId)!;
  const stormStages = getBossStormStages(props.progress, props.qaUnlocked, props.boss?.id);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => { latest.current = props; }, [props]);
  const nodes = useRef(new Map<string, HTMLElement>());
  const projectionRef = useRef<GlobeProjection | null>(null);
  const frame = useRef<GlobeSceneFrame>({ focus: selected.center, orientation: northUpGlobeOrientation(selected.center), zoom: props.initialOverview ? 0 : 1, activeDestinationId: destinationId, completedStopIds: props.progress.completedStopIds, dangerStages: props.dangerStages, stormStages });
  const [renderer, setRenderer] = useState<"loading" | "webgl" | "fallback">("loading");
  const rendererRef = useRef(renderer);
  useLayoutEffect(() => { rendererRef.current = renderer; }, [renderer]);
  const [navigationPhase, setPhase] = useState<Phase>(props.initialOverview ? "overview" : "focused");
  const phase = props.storyScene ? "story" : navigationPhase;
  const phaseRef = useRef<Phase>(phase);
  useLayoutEffect(() => { phaseRef.current = phase; }, [phase]);
  const [voyage, setVoyage] = useState<ArchipelagoVoyage | null>(null);
  const trip = useRef<{ cancel: () => void; skip?: () => void; finishActivity?: () => void } | null>(null);
  const animation = useRef<{ cancel: () => void } | null>(null);
  const motion = useRef(false);
  const pointer = useRef<{ x: number; y: number; moved: boolean; dragging: boolean } | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const irisRef = useRef<HTMLDivElement>(null);
  const [activity, setActivity] = useState<ArchipelagoVoyage | null>(null);
  const busy = !!props.interactionLocked || ["focusing", "sailing", "hopping", "activity", "story"].includes(phase);
  const storyStill = !!props.storyScene && (reducedScenery || sceneryPaused || renderer === "fallback");
  const storyContinueRef = useRef<HTMLButtonElement>(null);
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
        const point = p.danger && key === `stop:${p.danger.id}:review` ? { x: 50, y: 60 } : !p.boss && !p.danger && !p.storyScene && (key.startsWith("stop:") ? fallback.stopPoints[stopIndex] : book);
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
      const stormVisible = !isWorld || !BOSS_CHALLENGES.some(boss => boss.id === id) || (frame.current.stormStages?.[id] ?? 0) > 0;
      const dangerVisible = !isWorld || !dangerById(id) || (frame.current.dangerStages?.[id] ?? 0) > 0;
      const visible = dangerVisible && stormVisible && !!point?.visible && (isWorld ? phaseRef.current === "overview" : phaseRef.current === "focused");
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
    const p = latest.current;
    const orientation = next.orientation ?? (next.focus
      ? transportGlobeOrientation(frame.current.orientation ?? northUpGlobeOrientation(frame.current.focus), next.focus)
      : frame.current.orientation);
    frame.current = { ...frame.current, ...next, orientation, completedStopIds: p.progress.completedStopIds, storyScattered: p.storyScattered, dangerStages: p.dangerStages,
      overviewSpinning: phaseRef.current === "overview" && !pointer.current && !boardRef.current?.contains(document.activeElement) && !p.interactionLocked,
      stormStages: getBossStormStages(p.progress, p.qaUnlocked, next.activeDestinationId ?? frame.current.activeDestinationId) };
    sceneRef.current?.render(frame.current);
  }
  function turnOverviewScenery(radians: number) {
    if (phaseRef.current !== "overview" || pointer.current || boardRef.current?.contains(document.activeElement) || latest.current.interactionLocked || animation.current) return false;
    const orientation = turnGlobeOrientation(frame.current.orientation ?? northUpGlobeOrientation(frame.current.focus), radians, 0);
    paint({ orientation, focus: globeOrientationFocus(orientation) });
    return true;
  }
  function restingPosition(): Vec3 | undefined {
    const p = latest.current;
    if (p.boss || p.danger) return undefined;
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
      let raf = 0, deadline = 0, ended = false, elapsed = 0;
      let previous = performance.now();
      const finish = (complete: boolean) => {
        if (ended) return; ended = true;
        cancelAnimationFrame(raf); window.clearTimeout(deadline);
        if (complete) update(1);
        animation.current = null; resolve(complete);
      };
      animation.current = { cancel: () => finish(false) };
      const watchdog = () => {
        window.clearTimeout(deadline);
        deadline = window.setTimeout(() => finish(true), 1600);
      };
      const tick = (now: number) => {
        elapsed = advanceGlobeAnimationTime(elapsed, now - previous, duration); previous = now;
        const t = elapsed / duration;
        update(t);
        if (t >= 1) finish(true);
        else { watchdog(); raf = requestAnimationFrame(tick); }
      };
      watchdog(); raf = requestAnimationFrame(tick);
    });
  }
  function cancelTrip() { trip.current?.cancel(); }
  function restoreFocus() { requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus({ preventScroll: true })); }
  function settlePose() {
    const p = latest.current;
    const center = getGlobeDestination(p.danger?.id ?? p.boss?.id ?? p.world.id)!.center;
    paint({ focus: center, orientation: northUpGlobeOrientation(center), zoom: 1, activeDestinationId: p.danger?.id ?? p.boss?.id ?? p.world.id, cameraDestinationId: undefined, stormCameraBlend: undefined, boatPosition: undefined, boatHeading: undefined, avatarPosition: restingPosition(), avatarHop: 0 });
    setBoardPhase("focused");
    if (irisRef.current) irisRef.current.style.opacity = "0";
  }
  async function focusRegion() {
    if (trip.current || latest.current.interactionLocked) return false;
    const previous = { ...frame.current };
    const target = getGlobeDestination(latest.current.danger?.id ?? latest.current.boss?.id ?? latest.current.world.id)!.center;
    setBoardPhase("focusing");
    const startOrientation = previous.orientation ?? northUpGlobeOrientation(previous.focus);
    const targetOrientation = northUpGlobeOrientation(target);
    const completed = await animate(globeTransitionDuration(startOrientation, targetOrientation, 1 - previous.zoom), t => {
      const orientation = interpolateGlobeOrientation(startOrientation, targetOrientation, ease(t));
      paint({ focus: globeOrientationFocus(orientation), orientation, zoom: previous.zoom + (1 - previous.zoom) * ease(t), cameraDestinationId: undefined, stormCameraBlend: undefined });
    });
    if (completed) {
      setBoardPhase("focused"); paint({ avatarPosition: restingPosition() });
      requestAnimationFrame(() => { const first = latest.current.danger ? `${latest.current.danger.id}:review` : latest.current.world.stopIds.find(id => canOpenRequiredStop(latest.current.progress, id, latest.current.qaUnlocked)); nodes.current.get(`stop:${first}`)?.focus({ preventScroll: true }); });
    }
    return completed;
  }
  function allowed(id: string) {
    const p = latest.current;
    if (p.canNavigate) return p.canNavigate(id);
    const boss = BOSS_CHALLENGES.find(boss => boss.id === id);
    return boss ? canOpenBoss(p.progress, boss, p.qaUnlocked) : canOpenWorld(p.progress, id, p.qaUnlocked);
  }
  async function sailTo(id: string) {
    if (trip.current || latest.current.interactionLocked || !allowed(id)) return;
    const p = latest.current;
    const fromId = p.danger?.id ?? p.boss?.id ?? p.world.id;
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
        paint({ focus: target.center, orientation: northUpGlobeOrientation(target.center), zoom: 1, activeDestinationId: id, cameraDestinationId: undefined, stormCameraBlend: undefined, boatPosition: undefined, boatHeading: undefined, avatarPosition: undefined });
        setBoardPhase("focused"); latest.current.onNavigate(id);
      } else { settlePose(); restoreFocus(); }
    };
    trip.current = { cancel: () => finish(false), skip: () => finish(true) };
    setVoyage(voyageState); setBoardPhase("sailing");
    if (motion.current || renderer === "fallback") { finish(true); return; }
    const start = { ...frame.current };
    const departureOrientation = start.orientation ?? northUpGlobeOrientation(start.focus);
    const harborOrientation = transportGlobeOrientation(departureOrientation, route[0]);
    const departureDuration = globeTransitionDuration(departureOrientation, harborOrientation, .38 - start.zoom, 700);
    if (!await animate(departureDuration, t => paint({ focus: sphericalInterpolate(start.focus, route[0], ease(t)), zoom: start.zoom + (0.38 - start.zoom) * ease(t), cameraDestinationId: fromId, stormCameraBlend: (p.boss || p.danger ? 1 : 0) * (1 - ease(t)), avatarPosition: undefined, boatPosition: route[0], boatHeading: getSurfaceRouteTangent(route, 0) }))) return;
    const sailDuration = Math.max(2400, Math.min(10000, getSurfaceRouteLength(route) * 1900));
    const sail = async (from: number, to: number) => animate(sailDuration * (to - from), t => {
      const distance = from + (to - from) * voyageProgress(t);
      const position = sampleSurfaceRoute(route, distance);
      paint({ focus: position, zoom: 0.38, stormCameraBlend: 0, boatPosition: position, boatHeading: getSurfaceRouteTangent(route, distance) });
    });
    if (latest.current.voyageActivity) {
      if (!await sail(0, 0.5) || !active) return;
      setBoardPhase("activity"); setActivity(voyageState);
      await new Promise<void>(resolve => { if (trip.current) trip.current.finishActivity = resolve; else resolve(); });
      if (!active) return;
      setActivity(null); setBoardPhase("sailing");
      if (!await sail(0.5, 1) || !active) return;
    } else if (!await sail(0, 1) || !active) return;
    const arrivalOrientation = frame.current.orientation ?? northUpGlobeOrientation(route.at(-1)!);
    const targetOrientation = northUpGlobeOrientation(target.center);
    if (!await animate(globeTransitionDuration(arrivalOrientation, targetOrientation, .62), t => {
      const orientation = interpolateGlobeOrientation(arrivalOrientation, targetOrientation, ease(t));
      paint({ focus: globeOrientationFocus(orientation), orientation, zoom: 0.38 + 0.62 * ease(t), cameraDestinationId: target.id, stormCameraBlend: target.kind === "boss" || target.kind === "danger" ? ease(t) : 0 });
    }) || !active) return;
    finish(true);
  }
  async function openStop(id: string) {
    const p = latest.current;
    if (trip.current || p.interactionLocked || p.boss || !p.world.stopIds.includes(id) || !canOpenRequiredStop(p.progress, id, p.qaUnlocked)) return;
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
    const change = () => { motion.current = query.matches; if (latest.current.storyScene) return; if (query.matches) { if (trip.current?.skip) trip.current.skip(); else { cancelTrip(); animation.current?.cancel(); settlePose(); } } };
    query.addEventListener("change", change);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { if (latest.current.storyScene) { latest.current.onStorySceneEnd?.(); return; } cancelTrip(); if (phaseRef.current === "focusing") { animation.current?.cancel(); settlePose(); } } };
    const onHide = () => { if (document.hidden) cancelTrip(); };
    const onHistory = () => { if (latest.current.storyScene) return; cancelTrip(); animation.current?.cancel(); settlePose(); };
    const onScroll = () => { if (phaseRef.current === "hopping") cancelTrip(); };
    window.addEventListener("keydown", onKey); window.addEventListener("popstate", onHistory); document.addEventListener("visibilitychange", onHide); window.addEventListener("scroll", onScroll, true);
    const timer = window.setTimeout(() => { if (alive && !sceneRef.current) setRenderer("fallback"); }, 8000);
    void import("./globe-scene").then(({ createGlobeScene }) => {
      if (!alive || !canvasRef.current) return;
      const scene = createGlobeScene(canvasRef.current, { assetBasePath: basePath, animateScenery: !getSceneryPaused(), onProject: positionMarkers, onOverviewTurn: turnOverviewScenery, onUnavailable: () => { if (alive) { setRenderer("fallback"); cancelTrip(); animation.current?.cancel(); settlePose(); } } });
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
  useEffect(() => { sceneRef.current?.setSceneryMotion(!sceneryPaused && !props.storyScene && !props.interactionLocked); }, [sceneryPaused, props.storyScene, props.interactionLocked, renderer]);
  useEffect(() => {
    if (!props.storyScene || renderer === "loading") return;
    let alive = true, onScreen = true;
    const previous = { ...frame.current };
    const origin = getGlobeDestination(WORLD_DEFINITIONS[0].id)!.center;
    const start = northUpGlobeOrientation(origin);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let staticEnding = reduced.matches || renderer === "fallback";
    animation.current?.cancel();
    const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
    const show = (t: number) => {
      const widening = ease(clamp01((t - .12) / .28));
      const turn = ease(clamp01((t - .15) / .7));
      const orientation = turnGlobeOrientation(start, turn * 2.2, -.14 * Math.sin(turn * Math.PI));
      paint({ focus: globeOrientationFocus(orientation), orientation, zoom: 1 - widening,
        storyProgress: t, storyPullback: widening, avatarPosition: undefined });
    };
    const clock = createSceneryClock({ request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id), now: () => performance.now(),
      onFrame: seconds => { if (!alive) return; const t = Math.min(1, seconds / 11); show(t); if (t === 1) { clock.setRunning(false); latest.current.onStorySceneEnd?.(); } } });
    const reconcile = () => clock.setRunning(alive && !staticEnding && renderer === "webgl" && !getSceneryPaused() && !reduced.matches && !document.hidden && onScreen);
    const changeMotion = () => { if (reduced.matches) { staticEnding = true; show(1); } reconcile(); };
    const observer = new IntersectionObserver(entries => { onScreen = entries.some(entry => entry.isIntersecting); reconcile(); });
    if (boardRef.current) { boardRef.current.scrollIntoView({ block: "center", behavior: "instant" }); observer.observe(boardRef.current); }
    show(reduced.matches || getSceneryPaused() || renderer === "fallback" ? 1 : 0);
    storyContinueRef.current?.focus({ preventScroll: true });
    document.addEventListener("visibilitychange", reconcile);
    reduced.addEventListener("change", changeMotion);
    const unsubscribe = subscribeSceneryPreference(reconcile);
    reconcile();
    return () => { alive = false; clock.dispose(); observer.disconnect(); unsubscribe(); document.removeEventListener("visibilitychange", reconcile); reduced.removeEventListener("change", changeMotion);
      paint({ ...previous, storyProgress: null, storyPullback: 0 }); };
    // Reading callbacks and progress are consumed from latest, never restarting the scene.
  }, [props.storyScene, renderer]);
  const onBusyChange = props.onBusyChange;
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);
  useEffect(() => {
    if (trip.current) cancelTrip();
    animation.current?.cancel();
    paint({ focus: getGlobeDestination(destinationId)!.center, orientation: northUpGlobeOrientation(getGlobeDestination(destinationId)!.center), activeDestinationId: destinationId, cameraDestinationId: undefined, stormCameraBlend: undefined, avatarPosition: restingPosition() });
  }, [destinationId]);
  useEffect(() => { paint({ avatarPosition: trip.current || props.storyScene ? frame.current.avatarPosition : restingPosition() }); }, [props.dangerStages, props.progress, props.restingStopId, props.qaUnlocked, props.storyScattered, props.storyScene]);
  useEffect(() => { positionMarkers(projectionRef.current); }, [phase, destinationId, renderer, narrow, props.progress, props.qaUnlocked]);
  function turn(dx: number, dy: number, animated = false) {
    if (busy) return;
    const start = frame.current.orientation ?? northUpGlobeOrientation(frame.current.focus);
    const apply = (t: number) => {
      const orientation = turnGlobeOrientation(start, dx * t, dy * t);
      paint({ focus: globeOrientationFocus(orientation), orientation, zoom: 0 });
    };
    if (animated) void animate(240, t => apply(ease(t)));
    else { animation.current?.cancel(); apply(1); }
  }
  const VoyageActivity = props.voyageActivity;
  return <section className={styles.boardSection} aria-label={`${titleFor(destinationId)} globe map`}>
    <div className={styles.boardToolbar}>
      <span className={styles.boardEyebrow}>{phase === "overview" ? "A world of discoveries" : props.danger ? "A danger crossing" : props.boss ? "Into the hurricane" : getWorldBiome(props.world.number).label}</span>
      <div className={styles.sceneryControls}>
      {renderer === "webgl" && <label className={styles.skyControl}>Sky
        <select aria-label="Time of day" value={skyMode} disabled={!!props.storyScene} onChange={event => {
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
    <div ref={boardRef} className={styles.board} data-globe-phase={phase} data-globe-renderer={renderer} data-globe-boss={props.boss?.id} data-relevant-danger={Object.keys(props.dangerStages ?? {}).find(id => (props.dangerStages?.[id] ?? 0) > 0)} data-voyage-from={voyage?.fromDestinationId} data-voyage-to={voyage?.toDestinationId} data-story-cinematic={props.storyScene ? storyStill ? "still" : "active" : undefined} aria-busy={busy}
      onFocusCapture={() => paint()} onBlurCapture={() => { queueMicrotask(() => { if (boardRef.current && sceneRef.current) paint(); }); }}
      onPointerDown={event => { if (phase !== "overview") return; const dragging = !(event.target as HTMLElement).closest("button"); pointer.current = { x: event.clientX, y: event.clientY, moved: false, dragging }; if (dragging) event.currentTarget.setPointerCapture(event.pointerId); paint(); }}
      onPointerMove={event => { const p = pointer.current; if (!p?.dragging) return; const dx = event.clientX - p.x, dy = event.clientY - p.y; if (Math.hypot(dx, dy) > 2) p.moved = true; turn(-dx * 0.006, dy * 0.006); p.x = event.clientX; p.y = event.clientY; }}
      onPointerLeave={() => { if (pointer.current && !pointer.current.dragging) { pointer.current = null; paint(); } }}
      onPointerUp={() => { pointer.current = null; paint(); }} onPointerCancel={() => { pointer.current = null; paint(); }} onLostPointerCapture={() => { if (pointer.current) { pointer.current = null; paint(); } }}>
      <div ref={canvasRef} className={styles.canvas} data-globe-canvas aria-hidden="true" />
      {renderer === "loading" && <div className={styles.loading} role="status"><span>◎</span>Opening your globe…</div>}
      {renderer === "fallback" && !props.boss && !props.danger && <CoastScene mobile={narrow} className={styles.fallbackMap} completedRoadSlot={-1} worldNumber={props.world.number} />}
      {renderer === "fallback" && props.danger && (props.dangerStages?.[props.danger.id] ?? 0) > 0 && <Image className={styles.stormFallback} src={`${basePath}${DANGER_STORIES[props.danger.kind].illustration.src}`} width={1536} height={1024} alt="" unoptimized />}
      {renderer === "fallback" && props.danger && !(props.dangerStages?.[props.danger.id] ?? 0) && <CalmPassageArtwork className={styles.stormFallback} />}
      {renderer === "fallback" && props.boss && <StormArtwork className={styles.stormFallback} />}
      {renderer === "fallback" && props.storyScene && <CrystalFallStill className={styles.crystalStill} />}
      <div className={styles.markerLayer} inert={!!props.storyScene}>
        {props.danger && <button type="button" ref={node => { const key = `stop:${props.danger!.id}:review`; if (node) nodes.current.set(key, node); else nodes.current.delete(key); }} className={`${styles.stopPin} ${styles.currentPin}`} aria-label={props.dangerComplete ? "Danger crossing completed" : "Enter danger crossing"} disabled={busy || !props.dangerReady || props.dangerComplete} onClick={props.onOpenDanger}><span>{props.dangerComplete ? "✓" : "◇"}</span><small>Danger crossing</small></button> }
        {[...GLOBE_DESTINATIONS, ...GLOBE_DANGER_REGIONS].map(destination => {
          const boss = BOSS_CHALLENGES.find(boss => boss.id === destination.id);
          const available = props.canNavigate ? props.canNavigate(destination.id) : boss ? canOpenBoss(props.progress, boss, props.qaUnlocked) : canOpenWorld(props.progress, destination.id, props.qaUnlocked);
          const world = WORLD_DEFINITIONS.find(world => world.id === destination.id);
          const danger = dangerById(destination.id);
          return <button type="button" key={destination.id} ref={node => { if (node) nodes.current.set(`world:${destination.id}`, node); else nodes.current.delete(`world:${destination.id}`); }}
            className={`${styles.worldPin} ${boss ? styles.stormPin : ""} ${destination.id === destinationId ? styles.selectedPin : ""}`} style={{ visibility: "hidden" }}
            data-globe-destination={destination.id} data-storm-strength={boss ? stormStages[boss.id] : undefined} disabled={!available || busy || renderer !== "webgl"} aria-label={`${titleFor(destination.id)}. ${boss ? `${bossStormStageLabel(stormStages[boss.id])}. ` : ""}${available ? "Sail here" : "Locked"}.`} onClick={() => { void sailTo(destination.id); }}>
            <span>{boss ? <StormIcon /> : danger ? <DangerIcon kind={danger.kind} /> : world?.number}</span>{!available && <small aria-hidden="true">⌑</small>}
          </button>;
        })}
        {!props.boss && !props.danger && stops.map((stop, index) => {
          const complete = props.progress.completedStopIds.includes(stop.id);
          const available = canOpenRequiredStop(props.progress, stop.id, props.qaUnlocked);
          const fallback = renderer === "fallback";
          const point = layout.stopPoints[index];
          return <button type="button" key={stop.id} ref={node => { if (node) nodes.current.set(`stop:${stop.id}`, node); else nodes.current.delete(`stop:${stop.id}`); }}
            className={`${styles.stopPin} ${complete ? styles.completePin : currentStop?.id === stop.id ? styles.currentPin : ""}`}
            style={fallback ? { left: `${point.x}%`, top: `${point.y}%`, visibility: "visible" } : { visibility: "hidden" }}
            data-stop-id={stop.id} data-summit-shard={!!props.storyScattered && index === stops.length - 1 ? "true" : undefined} disabled={!available || busy} aria-current={currentStop?.id === stop.id ? "step" : undefined}
            aria-label={`${stop.label}. ${complete ? "Completed" : available ? "Available" : "Locked"}. ${QUESTIONS_BY_STOP.get(stop.id)?.length} questions.${props.storyScattered && index === stops.length - 1 ? " A Tideheart shard rests at this summit." : ""}`} onClick={() => { void openStop(stop.id); }}>
            <span>{complete ? "✓" : !available ? "⌑" : stop.kind === "culmination" ? "★" : index + 1}</span><small>{stop.shortLabel}</small>
          </button>;
        })}
        {!props.boss && !props.danger && layout.books.map((book, index) => <button type="button" key={`${props.world.id}:${book.id}`} ref={node => { const key = `book:${props.world.id}:${book.id}`; if (node) nodes.current.set(key, node); else nodes.current.delete(key); }}
          className={styles.bookPin} disabled={busy} data-story-island-id={book.islandId} data-story-book-id={book.id}
          style={renderer === "fallback" ? { left: `${book.x}%`, top: `${book.y}%`, visibility: "visible" } : { visibility: "hidden" }}
          aria-label={`Storybook on island ${index + 1}: ${props.storyBookLabels?.[index] ?? "coming soon"}`} aria-haspopup="dialog" onClick={event => props.onStory(index, event.currentTarget)}><BookIcon /></button>)}
      </div>
      {phase === "overview" && renderer === "webgl" && <div className={styles.orbitControls} aria-label="Turn the globe">
        <button type="button" aria-label="Turn globe left" onClick={() => turn(-0.45, 0, true)}>←</button>
        <button type="button" aria-label="Turn globe up" onClick={() => turn(0, 0.35, true)}>↑</button>
        <button type="button" aria-label="Turn globe down" onClick={() => turn(0, -0.35, true)}>↓</button>
        <button type="button" aria-label="Turn globe right" onClick={() => turn(0.45, 0, true)}>→</button>
      </div>}
      {voyage && <div className={styles.voyageCard} role="status"><span className={styles.voyageKicker}>ALL ABOARD</span><strong>Sailing to {titleFor(voyage.toDestinationId)}</strong><div><button type="button" onClick={() => trip.current?.skip?.()}>Skip voyage</button><button type="button" onClick={cancelTrip}>Cancel voyage</button></div></div>}
      {activity && VoyageActivity && <div className={styles.activity}><VoyageActivity voyage={activity} onContinue={() => trip.current?.finishActivity?.()} onCancel={cancelTrip} /></div>}
      {props.storyScene && <div className={styles.crystalCaption}>
        <div><span className={styles.voyageKicker}>The Tideheart falls</span><strong>Thirty-two lights cross Oceania</strong><p>{storyStill ? "One shard rests at the summit of each archipelago." : "Over the clouds, across the seas… a shard for every summit."}</p></div>
        <button ref={storyContinueRef} type="button" onClick={() => latest.current.onStorySceneEnd?.()}>Continue story <span aria-hidden="true">→</span></button>
      </div>}
      <div ref={irisRef} className={styles.iris} aria-hidden="true" />
    </div>
    <p className={styles.boardCaption}>{props.storyScene ? "The Tideheart’s light is scattered, but not lost." : props.danger && phase !== "overview" ? (props.dangerStages?.[props.danger.id] ?? 0) > 0 ? "One crossing. Take your time and use your paper packet." : "This crossing is clear. Your voyage notes and packet are still here." : props.boss && phase !== "overview" ? "The ship faces the storm. Print the whole test to take on this challenge." : renderer === "fallback" ? "Choose an island stop, or use the list below." : phase === "overview" ? "Drag to turn the globe. Choose a destination to set sail." : props.storyBookLabels ? "Choose a stop to explore. Open the two books to discover Oceania’s story." : "Choose a stop to explore. The two books hold stories to come."}</p>
  </section>;
});
