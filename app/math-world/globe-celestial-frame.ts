import * as THREE from "three";
import type { Vec3 } from "./globe-geometry.ts";

export const SKY_CYCLE_SECONDS = 360;
const up = new THREE.Vector3(0, 1, 0);

export function getCelestialCycleAngle(seconds: number) {
  return Math.max(0, Number.isFinite(seconds) ? seconds : 0) * Math.PI * 2 / SKY_CYCLE_SECONDS;
}

/** The renderer keeps the camera near +Z and turns the planet to navigate.
 * Inertial scenery must use that same change of reference frame. The initial
 * east/north/front basis preserves the authored sky composition at World 1;
 * its daily spin is the exact same positive rotation as the automatic sun. */
export function createCelestialFrame(anchor: Vec3) {
  const front = new THREE.Vector3().copy(anchor).normalize();
  const east = new THREE.Vector3().crossVectors(up, front);
  if (east.lengthSq() < .001) east.set(1, 0, 0);
  east.normalize();
  const north = new THREE.Vector3().crossVectors(front, east).normalize();
  const reference = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, north, front));
  const spin = new THREE.Quaternion();
  return {
    update(seconds: number, planetToView: THREE.Quaternion, target: THREE.Quaternion) {
      spin.setFromAxisAngle(up, getCelestialCycleAngle(seconds));
      return target.copy(planetToView).multiply(reference).multiply(spin);
    },
  };
}
