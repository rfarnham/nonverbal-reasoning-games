/** Shared canopy bend for island and mainland trees, including their shadows.
 * The caller supplies a root-anchored weight; foliage moves in a passing breeze
 * while the point at the base of each trunk remains exactly fixed. */
export const TREE_SWAY_GLSL = /* glsl */ `
  vec3 swayTree(vec3 point, vec3 anchor, float weight, float phase, float seconds) {
    vec3 up = normalize(anchor);
    vec3 east = normalize(cross(abs(up.y) > .98 ? vec3(0.,0.,1.) : vec3(0.,1.,0.), up));
    vec3 north = cross(up, east);
    float passing = .55 + .45 * sin(seconds * .29 + dot(anchor, vec3(3.,1.,2.)));
    float bend = sin(seconds * 1.12 + phase * .12) * (.68 + passing * .45);
    float leaves = sin(seconds * 2.65 + phase) * .18;
    return point + ((east + north * .38) * bend + north * leaves) * weight * .0032;
  }
`;
