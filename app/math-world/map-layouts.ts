/** Authored island maps. All rendered paths and avatar travel share this geometry. */
export type MapPoint = Readonly<{ x: number; y: number }>;
export type MapLandscape = "coast" | "mirror" | "orchard" | "pattern" | "shapes" | "lagoon" | "desert" | "canopy" | "cliffs" | "balance";
export type MapIslandShape = "bean" | "leaf" | "diamond" | "crescent" | "cloud" | "mesa" | "ring" | "petal" | "terrace" | "atoll";
export type MapIsland = Readonly<{
  id: string; x: number; y: number; rx: number; ry: number;
  shape: MapIslandShape; rotation?: number; stopIndex?: number;
}>;
export type MapBook = Readonly<{ id: string; islandId: string; x: number; y: number }>;
export type MapLayout = Readonly<{
  width: number; height: number; islands: readonly MapIsland[];
  stopPoints: readonly MapPoint[]; roads: readonly string[];
  books: readonly MapBook[]; storyPaths: readonly string[];
}>;
export type WorldMapLayout = Readonly<{
  worldNumber: number; landscape: MapLandscape; variant: 1 | 2;
  desktop: MapLayout; mobile: MapLayout;
}>;

type IslandAnchor = readonly [x: number, y: number, shape: MapIslandShape, rotation?: number];
type StoryAnchor = readonly [x: number, y: number, fromStop: number, shape: MapIslandShape];
type Bend = readonly [x1: number, y1: number, x2: number, y2: number];
const percent = (x: number, y: number, width: number, height: number): MapPoint => ({
  x: Math.round(x / width * 1e12) / 1e10,
  y: Math.round(y / height * 1e12) / 1e10,
});

function map(mobile: boolean, anchors: readonly IslandAnchor[], stories: readonly StoryAnchor[], bends: readonly Bend[]): MapLayout {
  const width = mobile ? 400 : 1200;
  const height = mobile ? 960 : 740;
  const islands: MapIsland[] = anchors.map(([x, y, shape, rotation], stopIndex) => ({
    id: `quiz-island-${stopIndex + 1}`, x, y,
    rx: mobile ? 108 : 153, ry: mobile ? 88 : 83,
    shape, ...(rotation ? { rotation } : {}), stopIndex,
  }));
  for (const [index, [x, y, , shape]] of stories.entries()) {
    islands.push({ id: `story-island-${index + 1}`, x, y, rx: mobile ? 60 : 81, ry: mobile ? 51 : 53, shape });
  }
  const stopPixels = anchors.map(([x, y]) => ({ x: mobile ? x : x - 65, y: mobile ? y - 28 : y + 10 }));
  const stopPoints = stopPixels.map(({ x, y }) => percent(x, y, width, height));
  const books = islands.filter(island => island.stopIndex === undefined).map(island => ({
    id: `book-${island.id}`, islandId: island.id, ...percent(island.x, island.y, width, height),
  }));
  const roads = bends.map(([x1, y1, x2, y2], index) => {
    const a = stopPixels[index];
    const b = stopPixels[index + 1];
    return `M${a.x} ${a.y} C${x1} ${y1} ${x2} ${y2} ${b.x} ${b.y}`;
  });
  const storyPaths = stories.map(([x, y, fromStop], index) => {
    const origin = islands[fromStop];
    // Small tributaries depart from the source island's edge, toward the story
    // island. They never add a progress stop or alter the four-stop sequence.
    const dx = x - origin.x;
    const dy = y - origin.y;
    const length = Math.hypot(dx, dy);
    const reach = Math.min(mobile ? 73 : 100, length * 0.3);
    const start = { x: origin.x + dx / length * reach, y: origin.y + dy / length * reach };
    const bend = (index % 2 === 0 ? 1 : -1) * (mobile ? 17 : 35);
    const c1 = { x: start.x + dx * 0.23 - dy / length * bend, y: start.y + dy * 0.23 + dx / length * bend };
    const c2 = { x: x - dx * 0.23 - dy / length * bend, y: y - dy * 0.23 + dx / length * bend };
    return `M${start.x.toFixed(2)} ${start.y.toFixed(2)} C${c1.x.toFixed(2)} ${c1.y.toFixed(2)} ${c2.x.toFixed(2)} ${c2.y.toFixed(2)} ${x} ${y}`;
  });
  return { width, height, islands, stopPoints, roads, books, storyPaths };
}

function world(worldNumber: number, landscape: MapLandscape, desktop: MapLayout, mobile: MapLayout): WorldMapLayout {
  return { worldNumber, landscape, variant: worldNumber > 10 ? 2 : 1, desktop, mobile };
}

/** Deliberately different routes: bays, loops, terraces, forks, and river bends.
 * The second spiral revisits its landscape with a new arrangement, not a recolor.
 */
export const WORLD_MAP_LAYOUTS: readonly WorldMapLayout[] = [
  // Counting Coast: a rising archipelago, with two quiet story coves.
  world(1, "coast",
    map(false, [[205,550,"bean"],[485,380,"atoll"],[785,545,"crescent"],[1000,250,"bean"]], [[215,205,0,"atoll"],[635,155,1,"crescent"]], [[235,565,295,390],[540,330,575,560],[900,580,850,285]]),
    map(true, [[125,175,"bean"],[265,380,"atoll"],[130,600,"crescent"],[255,815,"bean"]], [[305,95,0,"atoll"],[70,410,1,"crescent"]], [[115,245,270,255],[280,455,120,465],[100,675,245,680]])),
  // Mirror Meadow: two pairs face each other across a central reflecting lake.
  world(2, "mirror",
    map(false, [[230,550,"petal"],[260,215,"leaf"],[930,215,"leaf"],[960,550,"petal"]], [[590,400,1,"diamond"],[590,635,0,"petal"]], [[90,435,100,300],[370,90,700,90],[1030,315,1010,430]]),
    map(true, [[125,155,"petal"],[270,370,"leaf"],[270,605,"leaf"],[125,820,"petal"]], [[85,495,1,"diamond"],[305,880,3,"petal"]], [[105,230,275,240],[345,420,345,520],[280,680,100,690]])),
  // Number Orchard: stepping terraces, with little orchards off the main slope.
  world(3, "orchard",
    map(false, [[190,570,"leaf"],[505,480,"terrace"],[835,370,"leaf"],[1015,145,"terrace"]], [[220,220,0,"cloud"],[570,165,1,"leaf"]], [[280,610,325,525],[585,525,665,400],[875,370,875,230]]),
    map(true, [[120,175,"leaf"],[235,390,"terrace"],[135,615,"leaf"],[260,825,"terrace"]], [[305,105,0,"cloud"],[320,585,2,"leaf"]], [[220,180,170,320],[295,485,110,465],[90,690,250,695]])),
  // Pattern Grove: a broad clockwise spiral around an open center.
  world(4, "pattern",
    map(false, [[205,235,"cloud"],[555,140,"petal"],[995,325,"cloud"],[645,570,"petal"]], [[185,580,3,"leaf"],[1040,625,2,"cloud"]], [[245,120,380,125],[650,65,945,125],[1060,485,820,590]]),
    map(true, [[125,150,"cloud"],[270,365,"petal"],[240,605,"cloud"],[120,825,"petal"]], [[80,495,1,"leaf"],[315,885,3,"cloud"]], [[110,210,295,245],[330,455,345,465],[200,675,95,710]])),
  // Shape Shoals: a low shelf turns up through angular reef pieces.
  world(5, "shapes",
    map(false, [[195,550,"diamond"],[530,580,"mesa"],[1000,465,"diamond"],[805,155,"terrace"]], [[250,220,0,"diamond"],[590,305,1,"mesa"]], [[225,665,350,660],[630,650,850,540],[1050,400,995,210]]),
    map(true, [[265,155,"diamond"],[125,375,"mesa"],[255,590,"diamond"],[145,815,"terrace"]], [[75,125,0,"diamond"],[320,815,3,"mesa"]], [[270,235,105,240],[100,440,275,470],[270,665,125,680]])),
  // Logic Lagoon: a horseshoe wrapped around a central story atoll.
  world(6, "lagoon",
    map(false, [[220,575,"atoll"],[200,255,"ring"],[585,145,"atoll"],[975,340,"ring"]], [[625,475,2,"atoll"],[1010,630,3,"crescent"]], [[65,465,55,380],[255,115,365,95],[690,90,900,190]]),
    map(true, [[265,170,"atoll"],[125,380,"ring"],[130,610,"atoll"],[265,815,"ring"]], [[315,485,1,"atoll"],[75,880,3,"crescent"]], [[280,250,110,250],[55,455,55,495],[110,690,280,700]])),
  // Digit Dunes: sweeping dunes descend, then curl around a small oasis.
  world(7, "desert",
    map(false, [[210,185,"crescent"],[565,330,"mesa"],[970,565,"crescent"],[515,595,"mesa"]], [[930,155,1,"atoll"],[200,520,3,"mesa"]], [[315,120,325,280],[635,360,920,380],[885,685,630,700]]),
    map(true, [[135,155,"crescent"],[270,370,"mesa"],[130,600,"crescent"],[265,825,"mesa"]], [[80,380,1,"atoll"],[315,585,2,"mesa"]], [[90,245,290,245],[300,455,125,470],[90,680,290,685]])),
  // Hidden Canopy: a zigzag crossing between irregular treetop clusters.
  world(8, "canopy",
    map(false, [[210,560,"cloud"],[525,185,"leaf"],[665,550,"cloud"],[1025,190,"petal"]], [[215,185,1,"leaf"],[1020,610,2,"cloud"]], [[160,420,285,210],[650,260,365,435],[825,550,825,210]]),
    map(true, [[120,160,"cloud"],[265,385,"leaf"],[120,620,"cloud"],[265,825,"petal"]], [[315,100,0,"leaf"],[305,615,2,"cloud"]], [[180,250,305,235],[300,465,65,465],[65,700,265,680]])),
  // Cube Cliffs: staggered rock shelves climb steeply toward the summit.
  world(9, "cliffs",
    map(false, [[185,590,"terrace"],[440,370,"mesa"],[780,470,"terrace"],[1010,155,"mesa"]], [[215,145,1,"diamond"],[655,130,2,"terrace"]], [[220,575,285,430],[470,345,630,530],[860,450,855,235]]),
    map(true, [[120,170,"terrace"],[265,380,"mesa"],[130,605,"terrace"],[260,825,"mesa"]], [[310,75,0,"diamond"],[75,380,1,"terrace"]], [[130,220,310,285],[250,460,95,485],[115,690,305,695]])),
  // Balance Bridges: a high bridge followed by a long, low river crossing.
  world(10, "balance",
    map(false, [[190,240,"mesa"],[565,175,"diamond"],[510,560,"mesa"],[1010,520,"diamond"]], [[1030,160,1,"leaf"],[180,610,2,"diamond"]], [[250,100,370,75],[650,335,310,350],[580,690,835,645]]),
    map(true, [[265,160,"mesa"],[120,390,"diamond"],[265,610,"mesa"],[125,825,"diamond"]], [[75,125,0,"leaf"],[315,885,3,"diamond"]], [[305,235,75,270],[75,455,295,485],[300,690,100,680]])),
  // Counting Coast II: an inward curl, finishing at the sheltered center.
  world(11, "coast",
    map(false, [[190,215,"crescent"],[380,565,"atoll"],[995,510,"bean"],[780,175,"atoll"]], [[650,355,3,"crescent"],[1045,130,3,"bean"]], [[65,385,125,500],[460,680,730,670],[1105,345,980,180]]),
    map(true, [[270,175,"crescent"],[125,375,"atoll"],[265,595,"bean"],[130,815,"atoll"]], [[75,125,0,"crescent"],[315,880,3,"bean"]], [[315,245,80,260],[60,475,275,465],[315,680,90,680]])),
  // Mirror Meadow II: a diagonal reflection, with two small echo islands.
  world(12, "mirror",
    map(false, [[215,575,"leaf"],[550,520,"petal"],[680,205,"petal"],[1020,150,"leaf"]], [[200,225,0,"diamond"],[985,530,2,"diamond"]], [[225,695,400,665],[675,460,480,295],[740,100,855,70]]),
    map(true, [[125,165,"leaf"],[255,385,"petal"],[255,625,"petal"],[125,835,"leaf"]], [[315,95,0,"diamond"],[75,500,1,"diamond"]], [[95,235,270,250],[325,465,325,495],[270,705,105,715]])),
  // Number Orchard II: a grove loop circles a central market island.
  world(13, "orchard",
    map(false, [[205,520,"terrace"],[435,175,"leaf"],[955,225,"terrace"],[795,565,"leaf"]], [[580,390,2,"cloud"],[1035,610,3,"leaf"]], [[70,350,180,190],[510,60,780,85],[1060,395,950,570]]),
    map(true, [[260,165,"terrace"],[135,385,"leaf"],[130,620,"terrace"],[255,825,"leaf"]], [[320,485,1,"cloud"],[75,880,3,"leaf"]], [[300,245,100,245],[65,470,55,500],[100,695,290,690]])),
  // Pattern Grove II: a winding S, with alternating side clearings.
  world(14, "pattern",
    map(false, [[200,190,"petal"],[990,200,"cloud"],[220,540,"petal"],[990,565,"cloud"]], [[590,235,1,"leaf"],[605,525,2,"petal"]], [[340,55,665,60],[1050,370,70,385],[370,675,660,675]]),
    map(true, [[125,155,"petal"],[275,375,"cloud"],[120,605,"petal"],[265,825,"cloud"]], [[315,100,0,"leaf"],[80,880,3,"petal"]], [[75,245,330,255],[325,470,60,480],[65,700,310,690]])),
  // Shape Shoals II: a geometric stair folds back on itself.
  world(15, "shapes",
    map(false, [[195,550,"mesa"],[240,205,"diamond"],[635,340,"terrace"],[1010,535,"diamond"]], [[705,115,2,"mesa"],[1060,175,3,"diamond"]], [[45,465,40,285],[320,155,405,240],[730,285,820,540]]),
    map(true, [[260,155,"mesa"],[125,380,"diamond"],[270,610,"terrace"],[140,825,"diamond"]], [[75,120,0,"mesa"],[80,595,2,"diamond"]], [[320,235,65,255],[65,465,330,490],[320,690,100,690]])),
  // Logic Lagoon II: a diagonal chain threads two pools and an eastern cove.
  world(16, "lagoon",
    map(false, [[195,190,"ring"],[430,475,"crescent"],[785,190,"ring"],[1010,500,"atoll"]], [[185,625,1,"atoll"],[645,650,1,"crescent"]], [[305,205,205,355],[500,415,525,195],[845,115,1110,330]]),
    map(true, [[125,175,"ring"],[270,385,"crescent"],[125,610,"ring"],[260,825,"atoll"]], [[315,95,0,"atoll"],[75,390,1,"crescent"]], [[65,250,315,260],[315,470,65,480],[70,685,305,695]])),
  // Digit Dunes II: a broad dune ridge curls back to a low oasis.
  world(17, "desert",
    map(false, [[200,575,"mesa"],[525,175,"crescent"],[1015,320,"mesa"],[655,565,"atoll"]], [[195,175,1,"crescent"],[1030,640,2,"mesa"]], [[150,415,260,215],[615,70,905,135],[1020,525,805,615]]),
    map(true, [[270,175,"mesa"],[125,385,"crescent"],[250,605,"mesa"],[135,825,"atoll"]], [[75,115,0,"crescent"],[315,880,3,"mesa"]], [[305,265,75,255],[75,470,305,480],[305,690,90,695]])),
  // Hidden Canopy II: a branch climbs left, then spans two treetop clearings.
  world(18, "canopy",
    map(false, [[220,565,"petal"],[195,210,"cloud"],[635,480,"leaf"],[1015,215,"cloud"]], [[605,140,2,"petal"],[1045,610,3,"leaf"]], [[65,455,65,320],[315,205,360,510],[730,500,860,290]]),
    map(true, [[125,160,"petal"],[265,390,"cloud"],[125,625,"leaf"],[260,835,"cloud"]], [[310,75,0,"petal"],[315,615,2,"leaf"]], [[70,245,320,265],[320,470,70,495],[70,710,315,695]])),
  // Cube Cliffs II: four plateaus wrap around a deep central ravine.
  world(19, "cliffs",
    map(false, [[195,235,"mesa"],[285,555,"terrace"],[960,545,"mesa"],[1010,175,"terrace"]], [[630,340,1,"diamond"],[620,120,3,"terrace"]], [[45,370,45,485],[385,685,690,685],[1085,435,1110,325]]),
    map(true, [[265,175,"mesa"],[130,380,"terrace"],[130,615,"mesa"],[265,825,"terrace"]], [[315,495,1,"diamond"],[75,105,0,"terrace"]], [[320,245,75,245],[60,465,60,500],[75,695,315,690]])),
  // Balance Bridges II: the route doubles back across offset stepping stones.
  world(20, "balance",
    map(false, [[185,535,"diamond"],[580,175,"mesa"],[630,565,"diamond"],[1015,265,"mesa"]], [[190,165,0,"leaf"],[1050,640,3,"diamond"]], [[205,380,270,180],[665,300,350,410],[805,605,770,325]]),
    map(true, [[130,160,"diamond"],[265,380,"mesa"],[130,605,"diamond"],[265,815,"mesa"]], [[315,85,0,"leaf"],[75,385,1,"diamond"]], [[70,245,325,250],[320,465,75,475],[65,685,320,690]])),
];

export function getWorldMapLayout(worldNumber: number): WorldMapLayout {
  const layout = WORLD_MAP_LAYOUTS.find(candidate => candidate.worldNumber === worldNumber);
  if (!layout) throw new Error(`No authored map for Math World ${worldNumber}.`);
  return layout;
}
