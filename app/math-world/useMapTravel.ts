"use client";

import { useEffect, useRef, useState } from "react";
import { getMapTravelPoints } from "./map-travel";
import type { WorldStop } from "./world-data";

type Trip = {
  animations: Animation[];
  cleanup: () => void;
};

/** Keep map travel cosmetic: only arrival starts the canonical stop attempt. */
export function useMapTravel(origin: WorldStop) {
  const avatarRef = useRef<HTMLSpanElement>(null);
  const spriteRef = useRef<HTMLSpanElement>(null);
  const irisRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const tripRef = useRef<Trip | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [travel, setTravel] = useState<{ stop: WorldStop; phase: "travel" | "bounce" | "iris" } | null>(null);

  useEffect(() => {
    // Wait for React to re-enable the launch controls before restoring focus.
    if (travel) return;
    if (restoreFocusRef.current?.isConnected) restoreFocusRef.current.focus({ preventScroll: true });
    restoreFocusRef.current = null;
  }, [travel]);

  useEffect(() => () => {
    tripRef.current?.cleanup();
    tripRef.current = null;
  }, []);

  async function travelTo(stop: WorldStop, onArrival: () => void) {
    if (tripRef.current) return;
    const avatar = avatarRef.current;
    const sprite = spriteRef.current;
    const iris = irisRef.current;
    const map = mapRef.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!avatar || !sprite || !iris || !map || !avatar.animate || motion.matches) {
      onArrival();
      return;
    }

    const launcher = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trip: Trip = { animations: [], cleanup: () => {} };
    restoreFocusRef.current = null;
    tripRef.current = trip;
    let watchdog = 0;
    function settle(arrived: boolean) {
      if (tripRef.current !== trip) return;
      trip.cleanup();
      tripRef.current = null;
      if (!arrived) restoreFocusRef.current = launcher;
      setTravel(null);
      if (arrived) onArrival();
    }
    const cancel = () => settle(false);
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const finish = () => settle(true);
    trip.cleanup = () => {
      window.clearTimeout(watchdog);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("scroll", cancel, true);
      window.removeEventListener("keydown", onKey);
      motion.removeEventListener("change", finish);
      trip.animations.forEach((animation) => animation.cancel());
    };

    async function animate(element: HTMLElement, frames: Keyframe[], duration: number, easing = "linear") {
      if (tripRef.current !== trip) return;
      const animation = element.animate(frames, { duration, easing, fill: "forwards" });
      trip.animations.push(animation);
      await animation.finished;
    }

    setTravel({ stop, phase: "travel" });
    // Directory and bottom-of-map launchers should reveal the chosen stop first.
    map.querySelector<HTMLElement>(`[data-stop-id="${stop.id}"]`)?.scrollIntoView({ block: "nearest", behavior: "instant" });
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    if (tripRef.current !== trip) return;
    window.addEventListener("resize", cancel);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("keydown", onKey);
    motion.addEventListener("change", finish);
    watchdog = window.setTimeout(finish, 3200);

    try {
      const mobile = window.matchMedia("(max-width: 620px)").matches;
      const coordinate = (place: WorldStop) => ({ x: mobile ? place.mobileX : place.x, y: mobile ? place.mobileY : place.y });
      const route = getMapTravelPoints(origin.id, stop.id, mobile);
      const points = route.length > 1 ? route : [coordinate(origin), coordinate(stop)];
      const distance = points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
      const duration = Math.min(1350, 650 + distance * 4);
      const hops = Math.max(2, Math.round(duration / 240));
      const hopFrames = Array.from({ length: hops * 2 + 1 }, (_, index) => ({
        transform: `translateY(${index % 2 ? -18 : 0}px) rotate(${index % 2 ? -6 : 0}deg)`,
        easing: index % 2 ? "ease-in" : "ease-out",
      }));
      await Promise.all([
        animate(avatar, points.map(({ x, y }) => ({
          left: `calc(${x}% ${mobile ? "+ 18%" : "- 1%"})`,
          top: `calc(${y}% - ${mobile ? "1.5%" : "7%"})`,
        })), duration),
        animate(sprite, hopFrames, duration),
      ]);
      if (tripRef.current !== trip) return;
      setTravel({ stop, phase: "bounce" });
      await animate(sprite, [
        { transform: "scale(1.18, .8) translateY(5px)" },
        { transform: "scale(.9, 1.12) translateY(-27px)", offset: .45 },
        { transform: "scale(1.08, .92) translateY(1px)", offset: .8 },
        { transform: "scale(1) translateY(0)" },
      ], 360, "ease-in-out");
      if (tripRef.current !== trip) return;
      setTravel({ stop, phase: "iris" });
      const bounds = avatar.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      await animate(iris, [
        { opacity: 1, clipPath: `circle(0px at ${x}px ${y}px)` },
        { opacity: 1, clipPath: `circle(${radius}px at ${x}px ${y}px)` },
      ], 360, "cubic-bezier(.4, 0, .2, 1)");
      finish();
    } catch {
      // Cancelled navigation stays on the map; unavailable animation still opens the stop.
      if (tripRef.current === trip) finish();
    }
  }

  return { avatarRef, spriteRef, irisRef, mapRef, travel, travelTo };
}
