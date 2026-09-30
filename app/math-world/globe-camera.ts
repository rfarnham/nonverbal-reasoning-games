import * as THREE from "three";
import { getCelestialCycleAngle } from "./globe-celestial-frame.ts";
import type { GlobeOrientation } from "./globe-navigation.ts";

function orientationLength(orientation: GlobeOrientation) {
  const length = Math.hypot(orientation.x, orientation.y, orientation.z, orientation.w);
  if (!Number.isFinite(length) || length < 1e-12) throw new Error("A globe orientation must be finite and nonzero.");
  return length;
}

/** Advance the planet-local north/south axis within the retained view. Unlike
 * screen-relative navigation, this carries both poles along the same axis. */
export function rotateGlobeOnAxis(orientation: GlobeOrientation, radians: number): GlobeOrientation {
  if (!Number.isFinite(radians)) throw new Error("A globe rotation must be finite.");
  const length = orientationLength(orientation);
  const sine = Math.sin(radians / 2), cosine = Math.cos(radians / 2);
  return {
    x: (orientation.x * cosine - orientation.z * sine) / length,
    y: (orientation.y * cosine + orientation.w * sine) / length,
    z: (orientation.z * cosine + orientation.x * sine) / length,
    w: (orientation.w * cosine - orientation.y * sine) / length,
  };
}

/** Separate a physical axial planet pose from camera navigation. The board's
 * orientation Q still maps planet-local points to its canonical view; the
 * camera's world frame C = P Q^-1 preserves that view while orbiting the world.
 * Scratch state and caller-owned outputs are reused on every scenery frame. */
export function createGlobeReferenceFrame() {
  const viewToPlanet = new THREE.Quaternion();
  return {
    update(seconds: number, orientation: GlobeOrientation, planetRotation: THREE.Quaternion, cameraFrame: THREE.Quaternion): void {
      const length = orientationLength(orientation);
      const halfTurn = -getCelestialCycleAngle(seconds) / 2;
      planetRotation.set(0, Math.sin(halfTurn), 0, Math.cos(halfTurn));
      viewToPlanet.set(-orientation.x / length, -orientation.y / length, -orientation.z / length, orientation.w / length);
      cameraFrame.multiplyQuaternions(planetRotation, viewToPlanet).normalize();
    },
  };
}
