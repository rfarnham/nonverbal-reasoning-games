import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLOBE_DANGER_REGIONS, type Vec3 } from "./globe-geometry.ts";

const TAU = Math.PI * 2;
const random = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const vector = (p: Vec3) => new THREE.Vector3(p.x, p.y, p.z);

/** An isolated, soft discharge, never a rapid flash train. The phase differs
 * between squalls; paused/reduced scenery never leaves a bolt illuminated. */
export function globeSquallLightning(seconds: number, index: number, enabled: boolean): number {
  if (!enabled || !Number.isFinite(seconds) || seconds < 0) return 0;
  const period = 3.1 + (index % 3) * .19;
  const age = (seconds + index * .73) % period;
  return age < .62 ? Math.sin(age / .62 * Math.PI) ** 2 : 0;
}

const COMMON = /* glsl */ `
  uniform float dangerSeconds; uniform float dangerRadius; uniform float dangerStage;
  uniform float dangerFlash; uniform vec3 dangerSun;
  vec3 seaPoint(vec3 p) { return normalize(vec3(p.x*dangerRadius,1.0,p.z*dangerRadius))*(1.0+p.y*dangerRadius); }
`;

type Uniforms = {
  dangerSeconds: { value: number }; dangerRadius: { value: number };
  dangerStage: { value: number }; dangerFlash: { value: number };
  dangerSun: { value: THREE.Vector3 };
};

function paintedMaterial(uniforms: Uniforms, fragment: string, deform = "", transparent = false) {
  return new THREE.ShaderMaterial({
    uniforms, transparent, depthWrite: !transparent, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `${COMMON}
      attribute vec3 color; varying vec3 painted; varying vec3 localPoint; varying vec3 localNormal;
      void main(){ vec3 p=position; ${deform}
        painted=color; localPoint=p; localNormal=normal;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(seaPoint(p),1.0);
      }`,
    fragmentShader: /* glsl */ `${COMMON}
      varying vec3 painted; varying vec3 localPoint; varying vec3 localNormal;
      void main(){
        float daylight=smoothstep(-.18,.3,dangerSun.y);
        float diffuse=max(0.,dot(normalize(localNormal),dangerSun));
        vec3 lit=painted*(vec3(.17,.24,.35)+diffuse*vec3(.8,.77,.69)+daylight*.13);
        float alpha=dangerStage;
        ${fragment}
        gl_FragColor=vec4(lit,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function colorGeometry(geometry: THREE.BufferGeometry, color: number) {
  const c = new THREE.Color(color), data = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let index = 0; index < data.length; index += 3) { data[index] = c.r; data[index + 1] = c.g; data[index + 2] = c.b; }
  geometry.setAttribute("color", new THREE.BufferAttribute(data, 3));
  return geometry;
}

/** A continuous implicit cloud surface instead of intersecting sphere puffs.
 * Smooth union joins the broad anvil to its smaller, rolling lower billows. */
function squallCloudGeometry() {
  const smoothMin = (a: number, b: number, k: number) => {
    const h = Math.max(0, Math.min(1, .5 + .5 * (b - a) / k));
    return b * (1 - h) + a * h - k * h * (1 - h);
  };
  const lobes = [
    [0, .45, -.06, .57, .12, .29], [-.35, .54, -.02, .23, .19, .25],
    [.34, .58, -.03, .25, .20, .25], [-.04, .65, -.04, .28, .21, .25],
    [-.14, .78, -.12, .18, .14, .18],
    [-.22, .45, .13, .25, .13, .20], [.20, .46, .16, .29, .13, .20],
  ];
  const field = (x: number, y: number, z: number) => {
    let result = 2;
    for (const [cx, cy, cz, sx, sy, sz] of lobes) {
      const d = (Math.hypot((x - cx) / sx, (y - cy) / sy, (z - cz) / sz) - 1) * Math.min(sx, sy, sz);
      result = smoothMin(result, d, .030);
    }
    return Math.max(result + Math.sin(x * 32 + Math.sin(z * 21)) * Math.sin(y * 36) * Math.sin(z * 29) * .007, .33 - y);
  };
  type P = [number, number, number];
  const points: P[] = [], values: number[] = [], positions: number[] = [], normals: number[] = [];
  const nx = 42, ny = 22, nz = 28, at = (x: number, y: number, z: number) => (x * (ny + 1) + y) * (nz + 1) + z;
  for (let x = 0; x <= nx; x++) for (let y = 0; y <= ny; y++) for (let z = 0; z <= nz; z++) {
    const p: P = [-.79 + x / nx * 1.58, .29 + y / ny * .67, -.46 + z / nz * .88];
    points.push(p); values.push(field(...p));
  }
  const normal = ([x, y, z]: P): P => {
    const e = .001, v: P = [field(x + e, y, z) - field(x - e, y, z), field(x, y + e, z) - field(x, y - e, z), field(x, y, z + e) - field(x, y, z - e)];
    const length = Math.hypot(...v); return v.map(n => n / length) as P;
  };
  const triangle = (a: P, b: P, c: P) => {
    const na = normal(a), nb = normal(b), nc = normal(c);
    const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
    if ((u[1] * v[2] - u[2] * v[1]) * na[0] + (u[2] * v[0] - u[0] * v[2]) * na[1] + (u[0] * v[1] - u[1] * v[0]) * na[2] < 0) {
      positions.push(...a, ...c, ...b); normals.push(...na, ...nc, ...nb);
    } else { positions.push(...a, ...b, ...c); normals.push(...na, ...nb, ...nc); }
  };
  const tetrahedra = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const cube = [at(x, y, z), at(x + 1, y, z), at(x + 1, y + 1, z), at(x, y + 1, z), at(x, y, z + 1), at(x + 1, y, z + 1), at(x + 1, y + 1, z + 1), at(x, y + 1, z + 1)];
    if (cube.every(i => values[i] >= 0) || cube.every(i => values[i] < 0)) continue;
    for (const tetra of tetrahedra) {
      const inside = tetra.map(i => cube[i]).filter(i => values[i] < 0), outside = tetra.map(i => cube[i]).filter(i => values[i] >= 0);
      const edge = (a: number, b: number): P => { const t = values[a] / (values[a] - values[b]); return points[a].map((v, i) => v + (points[b][i] - v) * t) as P; };
      if (inside.length === 1) triangle(edge(inside[0], outside[0]), edge(inside[0], outside[1]), edge(inside[0], outside[2]));
      else if (inside.length === 3) triangle(edge(outside[0], inside[0]), edge(outside[0], inside[1]), edge(outside[0], inside[2]));
      else if (inside.length === 2) { const ac = edge(inside[0], outside[0]), ad = edge(inside[0], outside[1]), bc = edge(inside[1], outside[0]), bd = edge(inside[1], outside[1]); triangle(ac, ad, bc); triangle(ad, bd, bc); }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.translate(0, 0, -.20);
  return colorGeometry(geometry, 0x43546c);
}

function combined(pieces: THREE.BufferGeometry[]) {
  const geometry = mergeGeometries(pieces, false)!;
  for (const piece of pieces) piece.dispose();
  return geometry;
}

function tube(points: THREE.Vector3[], width: number, color: number, segments = 36, sides = 8) {
  return colorGeometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, width, sides, false), color);
}

function krakenGeometry() {
  const body: THREE.BufferGeometry[] = [], details: THREE.BufferGeometry[] = [];
  const ball = (pieces: THREE.BufferGeometry[], at: number[], scale: number[], color: number, width = 24, height = 16) => {
    const shape = new THREE.SphereGeometry(1, width, height); shape.scale(scale[0], scale[1], scale[2]); shape.translate(at[0], at[1], at[2]); pieces.push(colorGeometry(shape, color));
  };
  // A pear-shaped mantle, eyebrow ridges, rounded eyes and vertical pupils.
  ball(body, [0, .35, -.30], [.24, .39, .23], 0x874567);
  ball(body, [0, .16, -.16], [.25, .16, .22], 0x6a365c);
  for (const side of [-1, 1]) {
    ball(body, [side * .105, .68, -.14], [.084, .042, .040], 0x6a365c);
    ball(details, [side * .105, .62, -.10], [.068, .057, .031], 0xf6c674, 16, 12);
    ball(details, [side * .104, .621, -.07], [.012, .043, .009], 0x271d39, 12, 10);
    ball(details, [side * .112, .644, -.064], [.011, .012, .006], 0xfff3d8, 10, 8);
  }
  for (let arm = 0; arm < 8; arm++) {
    const angle = arm / 8 * TAU + .18, sign = arm % 2 ? 1 : -1;
    const polar = (r: number, a: number, y: number) => new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r - .075);
    const curve = new THREE.CatmullRomCurve3([
      polar(.12, angle, .13), polar(.37, angle + sign * .10, .08),
      polar(.63, angle + sign * .16, .12), polar(.73, angle + sign * .36, .28 + (arm % 3) * .045),
      polar(.62, angle + sign * .65, .40 + (arm % 3) * .04), polar(.50, angle + sign * .55, .32),
    ]);
    const segments = 40, sides = 10;
    const armGeometry = new THREE.TubeGeometry(curve, segments, 1, sides, false);
    const positions = armGeometry.getAttribute("position"), center = new THREE.Vector3();
    for (let section = 0; section <= segments; section++) {
      const t = section / segments, radius = .068 * (1 - t) ** .85 + .004;
      center.copy(curve.getPointAt(t));
      for (let side = 0; side <= sides; side++) {
        const index = section * (sides + 1) + side;
        positions.setXYZ(index, center.x + (positions.getX(index) - center.x) * radius,
          center.y + (positions.getY(index) - center.y) * radius, center.z + (positions.getZ(index) - center.z) * radius);
      }
    }
    armGeometry.computeVertexNormals(); body.push(colorGeometry(armGeometry, arm % 2 ? 0x8d4c76 : 0x764567));
    // Two rows of sculpted suction cups sit on each arm's inner upper side.
    for (let step = 1; step <= 12; step++) {
      const t = .12 + step / 12 * .73, at = curve.getPointAt(t), radius = .068 * (1 - t) ** .85 + .004;
      const tangent = curve.getTangentAt(t), sideways = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      for (const side of [-1, 1]) {
        const cup = new THREE.TorusGeometry(radius * .24, radius * .082, 5, 9);
        cup.rotateX(-Math.PI / 2); cup.translate(at.x + sideways.x * radius * .36 * side, at.y + radius * .86, at.z + sideways.z * radius * .36 * side);
        details.push(colorGeometry(cup, 0xf0b8a4));
      }
    }
  }
  return { body: combined(body), details: combined(details) };
}

function discGeometry() {
  const geometry = new THREE.RingGeometry(0, .95, 112, 18); geometry.rotateX(-Math.PI / 2);
  return colorGeometry(geometry, 0x147d91);
}

function particleGeometry(count: number) {
  const template = new THREE.PlaneGeometry(1, 1), geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(template.getIndex()!.clone());
  for (const [name, attribute] of Object.entries(template.attributes)) geometry.setAttribute(name, attribute.clone());
  template.dispose();
  geometry.instanceCount = count;
  const data: number[] = [];
  for (let i = 0; i < count; i++) data.push(random(i + 71), random(i + 319), random(i + 1127), random(i + 9191));
  geometry.setAttribute("dangerParticle", new THREE.InstancedBufferAttribute(new Float32Array(data), 4));
  return geometry;
}

function particleMaterial(uniforms: Uniforms, kind: "rain" | "foam") {
  return new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `${COMMON}
      attribute vec4 dangerParticle; varying vec2 particleUV; varying float particleAlpha;
      void main(){
        vec4 d=dangerParticle; vec3 p; vec2 size;
        ${kind === "rain" ? `
          float fall=fract(d.x+dangerSeconds*.61);
          p=vec3((d.y-.5)*1.08+fall*.16,.37*(1.-fall)+.035,(d.z-.5)*.43-.20);
          size=vec2(.006,.055); particleAlpha=sin(fall*3.14159)*.37;
        ` : `
          float life=fract(d.x+dangerSeconds*.035);
          float r=.16+.72*(1.-life);
          float a=d.y*6.283185-dangerSeconds*.17-life*7.;
          p=vec3(cos(a)*r,.037+.12*r*r,sin(a)*r);
          size=vec2(.012+.012*d.z); particleAlpha=sin(life*3.14159)*.8;
        `}
        vec4 view=modelViewMatrix*vec4(seaPoint(p),1.);
        view.xy+=position.xy*size*dangerRadius;
        ${kind === "rain" ? "view.x+=position.y*.025*dangerRadius;" : ""}
        gl_Position=projectionMatrix*view; particleUV=uv;
      }`,
    fragmentShader: /* glsl */ `${COMMON}
      varying vec2 particleUV; varying float particleAlpha;
      void main(){
        float edge=1.-smoothstep(.16,.5,length(particleUV-.5));
        float day=smoothstep(-.2,.3,dangerSun.y);
        gl_FragColor=vec4(mix(vec3(.24,.45,.64),vec3(.78,.94,1.),day),edge*particleAlpha*dangerStage);
      }`,
  });
}

/** All hazards share immutable geometry. GPU animation uses the map's paused
 * clock; eligibility and progress are supplied by the caller, never inferred. */
export function createGlobeDangers(globe: THREE.Group) {
  const root = new THREE.Group(); root.name = "Tideheart ocean dangers"; globe.add(root);
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  const keep = (geometry: THREE.BufferGeometry) => { geometries.add(geometry); return geometry; };
  const cloud = keep(squallCloudGeometry()), kraken = krakenGeometry(); keep(kraken.body); keep(kraken.details);
  const disc = keep(discGeometry()), rain = keep(particleGeometry(150)), foam = keep(particleGeometry(130));
  const winds: THREE.BufferGeometry[] = [];
  for (let band = 0; band < 3; band++) winds.push(tube(Array.from({ length: 48 }, (_, i) => {
    const t = i / 47, curl = Math.max(0, (t - .62) / .38) * Math.PI * 1.6;
    return new THREE.Vector3(-.74 + t * 1.31 + Math.sin(curl) * .10, .10 + band * .075 + Math.cos(curl) * .075, .25 + band * .09);
  }), .0045, 0xd9f3fa, 48, 5));
  const wind = keep(combined(winds));
  const bolts: THREE.BufferGeometry[] = [];
  for (let branch = 0; branch < 3; branch++) bolts.push(tube([
    new THREE.Vector3(-.18 + branch * .23, .45 - branch * .03, .16),
    new THREE.Vector3(-.11 + branch * .17, .31, .13),
    new THREE.Vector3(-.21 + branch * .21, .24, .16),
    new THREE.Vector3(-.12 + branch * .18, .07 + branch * .03, .18),
  ], .006, 0xe8f5ff, 10, 5));
  const lightning = keep(combined(bolts));

  const systems = GLOBE_DANGER_REGIONS.map((region, index) => {
    const group = new THREE.Group(); group.name = `${region.id} ${region.dangerKind}`;
    group.matrix.makeBasis(vector(region.east), vector(region.center), vector(region.north).negate()); group.matrixAutoUpdate = false; group.visible = false; root.add(group);
    const uniforms: Uniforms = { dangerSeconds: { value: 0 }, dangerRadius: { value: Math.tan(region.angularRadius) }, dangerStage: { value: 0 }, dangerFlash: { value: 0 }, dangerSun: { value: new THREE.Vector3(.4, .8, .2).normalize() } };
    const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, order = 0) => {
      materials.add(material); const mesh = new THREE.Mesh(geometry, material); mesh.name = `${region.id} ${name}`; mesh.frustumCulled = false; mesh.renderOrder = order; group.add(mesh); return mesh;
    };
    let details: THREE.Mesh | undefined;
    if (region.dangerKind === "squall") {
      add("sculpted thundercloud", cloud, paintedMaterial(uniforms, /* glsl */ `
        lit*=mix(.33,1.,smoothstep(.34,.72,localPoint.y));
        lit+=vec3(.010,.018,.032)*(1.-daylight)*max(0.,localNormal.y);
        lit+=vec3(.4,.57,.82)*dangerFlash*exp(-length(localPoint-vec3(.02,.4,.12))*3.5);
      `, "p.x+=sin(dangerSeconds*.20+position.y*7.)*.008;"));
      add("slanting rain", rain, particleMaterial(uniforms, "rain"), 2);
      add("curling wind", wind, paintedMaterial(uniforms, "lit=mix(vec3(.3,.52,.66),painted,daylight); alpha*=.21+.13*sin(localPoint.x*4.-dangerSeconds*.8);", "p.x+=sin(dangerSeconds*.4)*.016;", true), 3);
      add("branched lightning", lightning, paintedMaterial(uniforms, "lit=vec3(.72,.88,1.); alpha*=dangerFlash;", "p.z-=.20;", true), 4);
    } else if (region.dangerKind === "kraken") {
      const sway = "p.y+=sin(dangerSeconds*.67+position.x*4.+position.z*3.)*.022*smoothstep(.22,.68,length(position.xz));";
      add("eight sculpted tentacles and mantle", kraken.body, paintedMaterial(uniforms, /* glsl */ `
        float wet=pow(max(0.,dot(reflect(-dangerSun,normalize(localNormal)),vec3(0.,1.,0.))),22.);
        lit+=vec3(.55,.72,.84)*wet*.22;
        lit+=vec3(.07,.035,.09)*(1.-daylight);
      `, sway));
      details = add("suction cups and amber eyes", kraken.details, paintedMaterial(uniforms, "lit+=painted*(1.-daylight)*.20;", sway));
      add("tentacle wake", disc, paintedMaterial(uniforms, /* glsl */ `
        float r=length(localPoint.xz);
        float wake=pow(max(0.,sin(r*75.-dangerSeconds*1.2)),14.);
        lit=mix(vec3(.15,.4,.5),vec3(.60,.89,.91),daylight);
        alpha*=wake*smoothstep(.32,.50,r)*(1.-smoothstep(.74,.95,r))*.20;
      `, "p.y=.02;", true), 1);
    } else {
      add("deep spiral funnel", disc, paintedMaterial(uniforms, /* glsl */ `
        float r=length(localPoint.xz),a=atan(localPoint.z,localPoint.x);
        float ripple=sin(a*17.-r*91.+dangerSeconds*.45)*.09;
        float spiral=.5+.5*sin(a*5.+log(r+.06)*12.+dangerSeconds*.75+ripple);
        float crests=pow(spiral,25.)*smoothstep(.15,.83,r);
        vec3 water=mix(vec3(.001,.003,.009),vec3(.008,.09,.17),smoothstep(.09,.90,r));
        water+=crests*vec3(.04,.16,.19);
        float rim=pow(.5+.5*sin(a*9.+r*90.+dangerSeconds*.55),18.)*smoothstep(.72,.91,r);
        lit=water*(.38+daylight*.8)+rim*vec3(.21,.43,.47)*(.3+.7*daylight);
        alpha*=1.-smoothstep(.80,.95,r);
      `, "float r=length(p.xz); p.y=.025+.12*r*r;", true));
      add("inward spiral foam", foam, particleMaterial(uniforms, "foam"), 2);
      add("raised curling rim", disc, paintedMaterial(uniforms, /* glsl */ `
        float r=length(localPoint.xz),a=atan(localPoint.z,localPoint.x);
        float ridges=pow(.5+.5*sin(a*5.+log(r+.05)*12.+dangerSeconds*.75),26.);
        lit=mix(vec3(.10,.35,.48),vec3(.8,.97,.96),daylight);
        alpha*=ridges*smoothstep(.58,.80,r)*(1.-smoothstep(.80,.94,r))*.36;
      `, "float r=length(p.xz); p.y=.028+.12*r*r;", true), 1);
    }
    return { region, index, group, uniforms, details, inverse: group.matrix.clone().invert() };
  });
  let disposed = false;
  return {
    update(seconds: number, focus: Vec3, zoom: number, activeId: string, stages: Readonly<Record<string, number>>, motionEnabled: boolean, sunDirection?: THREE.Vector3) {
      if (disposed) return;
      for (const system of systems) {
        const stage = THREE.MathUtils.clamp(Number.isFinite(stages[system.region.id]) ? stages[system.region.id] : 0, 0, 1);
        const facing = system.region.center.x * focus.x + system.region.center.y * focus.y + system.region.center.z * focus.z;
        system.group.visible = stage > 0 && (facing > -.12 || activeId === system.region.id);
        system.uniforms.dangerStage.value = stage;
        system.uniforms.dangerSeconds.value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
        system.uniforms.dangerFlash.value = globeSquallLightning(seconds, system.index, motionEnabled);
        if (sunDirection) system.uniforms.dangerSun.value.copy(sunDirection).transformDirection(system.inverse);
        if (system.details) system.details.visible = zoom > .4 && (activeId === system.region.id || facing > .88);
      }
    },
    dispose() {
      if (disposed) return; disposed = true; globe.remove(root); root.clear();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
