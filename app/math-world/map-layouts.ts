/** Authored island maps. All rendered paths and avatar travel share this geometry. */
export type MapPoint = Readonly<{ x: number; y: number }>;
export type MapLandscape = "coast" | "mirror" | "orchard" | "pattern" | "shapes" | "lagoon" | "desert" | "canopy" | "cliffs" | "balance" | "sharing" | "fractions" | "measurement" | "market" | "clock" | "area";
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
  return { worldNumber, landscape, variant: worldNumber > 16 ? 2 : 1, desktop, mobile };
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
  // Sharing Gardens: paired picnic clearings follow the two banks of a winding inlet.
  world(7, "sharing",
    map(false, [[205,185,"petal"],[240,525,"leaf"],[730,560,"petal"],[1010,240,"leaf"]], [[625,200,0,"cloud"],[1045,605,2,"petal"]], [[55,305,65,435],[350,640,495,690],[800,505,1060,410]]),
    map(true, [[125,175,"petal"],[125,410,"leaf"],[270,620,"petal"],[265,830,"leaf"]], [[315,110,0,"cloud"],[75,700,2,"petal"]], [[45,225,45,320],[130,465,295,475],[345,665,345,745]])),
  // Digit Dunes: sweeping dunes descend, then curl around a small oasis.
  world(8, "desert",
    map(false, [[210,185,"crescent"],[565,330,"mesa"],[970,565,"crescent"],[515,595,"mesa"]], [[930,155,1,"atoll"],[200,520,3,"mesa"]], [[315,120,325,280],[635,360,920,380],[885,685,630,700]]),
    map(true, [[135,155,"crescent"],[270,370,"mesa"],[130,600,"crescent"],[265,825,"mesa"]], [[80,380,1,"atoll"],[315,585,2,"mesa"]], [[90,245,290,245],[300,455,125,470],[90,680,290,685]])),
  // Hidden Canopy: a zigzag crossing between irregular treetop clusters.
  world(9, "canopy",
    map(false, [[210,560,"cloud"],[525,185,"leaf"],[665,550,"cloud"],[1025,190,"petal"]], [[215,185,1,"leaf"],[1020,610,2,"cloud"]], [[160,420,285,210],[650,260,365,435],[825,550,825,210]]),
    map(true, [[120,160,"cloud"],[265,385,"leaf"],[120,620,"cloud"],[265,825,"petal"]], [[315,100,0,"leaf"],[305,615,2,"cloud"]], [[180,250,305,235],[300,465,65,465],[65,700,265,680]])),
  // Fraction Fjords: a wide half-circle passes two small divided garden islets.
  world(10, "fractions",
    map(false, [[195,405,"crescent"],[470,155,"ring"],[1010,245,"crescent"],[825,570,"ring"]], [[255,650,0,"diamond"],[650,385,3,"petal"]], [[105,270,245,110],[565,40,850,60],[1090,405,1000,535]]),
    map(true, [[260,165,"crescent"],[265,390,"ring"],[125,610,"crescent"],[125,835,"ring"]], [[75,100,0,"diamond"],[315,720,2,"petal"]], [[350,225,350,300],[280,460,85,465],[45,675,45,745]])),
  // Cube Cliffs: staggered rock shelves climb steeply toward the summit.
  world(11, "cliffs",
    map(false, [[185,590,"terrace"],[440,370,"mesa"],[780,470,"terrace"],[1010,155,"mesa"]], [[215,145,1,"diamond"],[655,130,2,"terrace"]], [[220,575,285,430],[470,345,630,530],[860,450,855,235]]),
    map(true, [[120,170,"terrace"],[265,380,"mesa"],[130,605,"terrace"],[260,825,"mesa"]], [[310,75,0,"diamond"],[75,380,1,"terrace"]], [[130,220,310,285],[250,460,95,485],[115,690,305,695]])),
  // Measuring Mills: the trail crosses the valley before climbing a narrow northern spur.
  world(12, "measurement",
    map(false, [[200,540,"terrace"],[605,610,"mesa"],[1010,465,"terrace"],[770,150,"mesa"]], [[230,190,0,"leaf"],[600,340,1,"diamond"]], [[260,670,410,695],[715,665,950,660],[1100,350,920,155]]),
    map(true, [[130,160,"terrace"],[270,360,"mesa"],[265,615,"terrace"],[125,820,"mesa"]], [[75,450,1,"leaf"],[310,880,3,"diamond"]], [[95,210,280,230],[350,420,350,505],[280,690,85,675]])),
  // Market Harbor: a long quay doubles back around the central harbor square.
  world(13, "market",
    map(false, [[205,190,"mesa"],[970,160,"bean"],[1005,525,"mesa"],[490,550,"bean"]], [[220,560,3,"cloud"],[600,350,1,"atoll"]], [[325,75,735,65],[1105,230,1120,430],[850,665,570,675]]),
    map(true, [[265,175,"mesa"],[125,395,"bean"],[125,620,"mesa"],[270,825,"bean"]], [[315,485,1,"cloud"],[75,885,3,"atoll"]], [[325,220,70,260],[40,465,45,510],[85,675,320,695]])),
  // Clockwork Gardens: a counterclockwise sweep crosses the sundial's southern edge.
  world(14, "clock",
    map(false, [[1010,215,"ring"],[615,140,"petal"],[210,375,"ring"],[625,605,"petal"]], [[1005,575,0,"cloud"],[235,650,2,"diamond"]], [[855,80,695,50],[430,110,145,200],[130,530,370,655]]),
    map(true, [[130,175,"ring"],[265,395,"petal"],[130,620,"ring"],[265,820,"petal"]], [[315,100,0,"cloud"],[75,870,3,"diamond"]], [[225,200,325,270],[310,470,85,450],[70,690,310,715]])),
  // Patchwork Terraces: an angular valley steps left, climbs, and opens onto a broad plateau.
  world(15, "area",
    map(false, [[470,590,"terrace"],[190,300,"diamond"],[650,160,"terrace"],[1020,490,"diamond"]], [[205,620,0,"mesa"],[1045,165,3,"terrace"]], [[425,390,70,525],[225,155,400,85],[805,135,1000,285]]),
    map(true, [[265,175,"terrace"],[130,400,"diamond"],[265,625,"terrace"],[130,835,"diamond"]], [[75,115,0,"mesa"],[315,870,3,"terrace"]], [[175,205,65,280],[75,475,320,465],[320,705,90,700]])),
  // Balance Bridges: a high bridge followed by a long, low river crossing.
  world(16, "balance",
    map(false, [[190,240,"mesa"],[565,175,"diamond"],[510,560,"mesa"],[1010,520,"diamond"]], [[1030,160,1,"leaf"],[180,610,2,"diamond"]], [[250,100,370,75],[650,335,310,350],[580,690,835,645]]),
    map(true, [[265,160,"mesa"],[120,390,"diamond"],[265,610,"mesa"],[125,825,"diamond"]], [[75,125,0,"leaf"],[315,885,3,"diamond"]], [[305,235,75,270],[75,455,295,485],[300,690,100,680]])),
  // Counting Coast II: an inward curl, finishing at the sheltered center.
  world(17, "coast",
    map(false, [[190,215,"crescent"],[380,565,"atoll"],[995,510,"bean"],[780,175,"atoll"]], [[650,355,3,"crescent"],[1045,130,3,"bean"]], [[65,385,125,500],[460,680,730,670],[1105,345,980,180]]),
    map(true, [[270,175,"crescent"],[125,375,"atoll"],[265,595,"bean"],[130,815,"atoll"]], [[75,125,0,"crescent"],[315,880,3,"bean"]], [[315,245,80,260],[60,475,275,465],[315,680,90,680]])),
  // Mirror Meadow II: a diagonal reflection, with two small echo islands.
  world(18, "mirror",
    map(false, [[215,575,"leaf"],[550,520,"petal"],[680,205,"petal"],[1020,150,"leaf"]], [[200,225,0,"diamond"],[985,530,2,"diamond"]], [[225,695,400,665],[675,460,480,295],[740,100,855,70]]),
    map(true, [[125,165,"leaf"],[255,385,"petal"],[255,625,"petal"],[125,835,"leaf"]], [[315,95,0,"diamond"],[75,500,1,"diamond"]], [[95,235,270,250],[325,465,325,495],[270,705,105,715]])),
  // Number Orchard II: a grove loop circles a central market island.
  world(19, "orchard",
    map(false, [[205,520,"terrace"],[435,175,"leaf"],[955,225,"terrace"],[795,565,"leaf"]], [[580,390,2,"cloud"],[1035,610,3,"leaf"]], [[70,350,180,190],[510,60,780,85],[1060,395,950,570]]),
    map(true, [[260,165,"terrace"],[135,385,"leaf"],[130,620,"terrace"],[255,825,"leaf"]], [[320,485,1,"cloud"],[75,880,3,"leaf"]], [[300,245,100,245],[65,470,55,500],[100,695,290,690]])),
  // Pattern Grove II: a winding S, with alternating side clearings.
  world(20, "pattern",
    map(false, [[200,190,"petal"],[990,200,"cloud"],[220,540,"petal"],[990,565,"cloud"]], [[590,235,1,"leaf"],[605,525,2,"petal"]], [[340,55,665,60],[1050,370,70,385],[370,675,660,675]]),
    map(true, [[125,155,"petal"],[275,375,"cloud"],[120,605,"petal"],[265,825,"cloud"]], [[315,100,0,"leaf"],[80,880,3,"petal"]], [[75,245,330,255],[325,470,60,480],[65,700,310,690]])),
  // Shape Shoals II: a geometric stair folds back on itself.
  world(21, "shapes",
    map(false, [[195,550,"mesa"],[240,205,"diamond"],[635,340,"terrace"],[1010,535,"diamond"]], [[705,115,2,"mesa"],[1060,175,3,"diamond"]], [[45,465,40,285],[320,155,405,240],[730,285,820,540]]),
    map(true, [[260,155,"mesa"],[125,380,"diamond"],[270,610,"terrace"],[140,825,"diamond"]], [[75,120,0,"mesa"],[80,595,2,"diamond"]], [[320,235,65,255],[65,465,330,490],[320,690,100,690]])),
  // Logic Lagoon II: a diagonal chain threads two pools and an eastern cove.
  world(22, "lagoon",
    map(false, [[195,190,"ring"],[430,475,"crescent"],[785,190,"ring"],[1010,500,"atoll"]], [[185,625,1,"atoll"],[645,650,1,"crescent"]], [[305,205,205,355],[500,415,525,195],[845,115,1110,330]]),
    map(true, [[125,175,"ring"],[270,385,"crescent"],[125,610,"ring"],[260,825,"atoll"]], [[315,95,0,"atoll"],[75,390,1,"crescent"]], [[65,250,315,260],[315,470,65,480],[70,685,305,695]])),
  // Sharing Gardens II: a picnic river loops around a central meeting meadow.
  world(23, "sharing",
    map(false, [[205,550,"leaf"],[535,180,"petal"],[1010,490,"leaf"],[565,600,"petal"]], [[200,190,1,"cloud"],[1025,170,2,"leaf"]], [[135,335,335,120],[710,130,1030,270],[950,650,700,690]]),
    map(true, [[270,175,"leaf"],[130,385,"petal"],[270,605,"leaf"],[135,825,"petal"]], [[75,115,0,"cloud"],[315,880,3,"leaf"]], [[320,245,85,250],[90,485,295,450],[325,665,95,690]])),
  // Digit Dunes II: a broad dune ridge curls back to a low oasis.
  world(24, "desert",
    map(false, [[200,575,"mesa"],[525,175,"crescent"],[1015,320,"mesa"],[655,565,"atoll"]], [[195,175,1,"crescent"],[1030,640,2,"mesa"]], [[150,415,260,215],[615,70,905,135],[1020,525,805,615]]),
    map(true, [[270,175,"mesa"],[125,385,"crescent"],[250,605,"mesa"],[135,825,"atoll"]], [[75,115,0,"crescent"],[315,880,3,"mesa"]], [[305,265,75,255],[75,470,305,480],[305,690,90,695]])),
  // Hidden Canopy II: a branch climbs left, then spans two treetop clearings.
  world(25, "canopy",
    map(false, [[220,565,"petal"],[195,210,"cloud"],[635,480,"leaf"],[1015,215,"cloud"]], [[605,140,2,"petal"],[1045,610,3,"leaf"]], [[65,455,65,320],[315,205,360,510],[730,500,860,290]]),
    map(true, [[125,160,"petal"],[265,390,"cloud"],[125,625,"leaf"],[260,835,"cloud"]], [[310,75,0,"petal"],[315,615,2,"leaf"]], [[70,245,320,265],[320,470,70,495],[70,710,315,695]])),
  // Fraction Fjords II: the path wraps two facing coves before crossing a narrow strait.
  world(26, "fractions",
    map(false, [[205,225,"ring"],[285,575,"crescent"],[735,510,"ring"],[1010,165,"crescent"]], [[590,175,0,"diamond"],[1050,610,2,"ring"]], [[40,320,80,515],[370,685,600,680],[900,490,885,295]]),
    map(true, [[125,175,"ring"],[270,380,"crescent"],[270,620,"ring"],[130,825,"crescent"]], [[75,495,1,"diamond"],[315,890,3,"ring"]], [[130,250,320,255],[355,455,355,515],[280,690,90,690]])),
  // Cube Cliffs II: four plateaus wrap around a deep central ravine.
  world(27, "cliffs",
    map(false, [[195,235,"mesa"],[285,555,"terrace"],[960,545,"mesa"],[1010,175,"terrace"]], [[630,340,1,"diamond"],[620,120,3,"terrace"]], [[45,370,45,485],[385,685,690,685],[1085,435,1110,325]]),
    map(true, [[265,175,"mesa"],[130,380,"terrace"],[130,615,"mesa"],[265,825,"terrace"]], [[315,495,1,"diamond"],[75,105,0,"terrace"]], [[320,245,75,245],[60,465,60,500],[75,695,315,690]])),
  // Measuring Mills II: a three-sided measuring trail rises around a deep central basin.
  world(28, "measurement",
    map(false, [[195,200,"mesa"],[550,565,"terrace"],[1010,525,"mesa"],[940,145,"terrace"]], [[190,585,1,"diamond"],[585,175,3,"leaf"]], [[170,380,305,580],[625,670,810,665],[1125,400,1090,255]]),
    map(true, [[270,175,"mesa"],[135,385,"terrace"],[135,625,"mesa"],[265,825,"terrace"]], [[320,495,1,"diamond"],[75,880,3,"leaf"]], [[320,245,75,255],[50,465,50,515],[95,700,320,690]])),
  // Market Harbor II: wharves descend from the northern market, then turn upriver.
  world(29, "market",
    map(false, [[205,190,"bean"],[655,165,"mesa"],[1010,515,"bean"],[400,570,"mesa"]], [[195,540,3,"atoll"],[1060,180,2,"cloud"]], [[265,75,465,65],[830,115,1080,315],[865,675,580,700]]),
    map(true, [[125,160,"bean"],[265,380,"mesa"],[130,610,"bean"],[265,830,"mesa"]], [[315,100,0,"atoll"],[75,390,1,"cloud"]], [[185,195,315,260],[295,475,75,455],[65,690,315,700]])),
  // Clockwork Gardens II: a clockwise crescent surrounds two quiet calendar gardens.
  world(30, "clock",
    map(false, [[195,420,"petal"],[430,160,"ring"],[1005,280,"petal"],[840,605,"ring"]], [[240,660,0,"diamond"],[600,405,2,"cloud"]], [[95,275,255,105],[565,45,905,110],[1100,410,1030,590]]),
    map(true, [[265,175,"petal"],[265,405,"ring"],[125,625,"petal"],[125,830,"ring"]], [[75,95,0,"diamond"],[315,730,2,"cloud"]], [[350,240,350,310],[285,475,80,475],[40,690,40,745]])),
  // Patchwork Terraces II: offset quilt fields fold from the west bank to a high eastern ridge.
  world(31, "area",
    map(false, [[195,550,"diamond"],[500,185,"terrace"],[765,575,"diamond"],[1010,215,"terrace"]], [[200,170,1,"mesa"],[800,100,2,"diamond"]], [[120,355,330,120],[760,165,400,670],[945,585,1120,360]]),
    map(true, [[125,175,"diamond"],[265,400,"terrace"],[125,620,"diamond"],[265,825,"terrace"]], [[315,105,0,"mesa"],[315,620,2,"diamond"]], [[65,250,310,260],[320,480,70,475],[65,700,315,695]])),
  // Balance Bridges II: the route doubles back across offset stepping stones.
  world(32, "balance",
    map(false, [[185,535,"diamond"],[580,175,"mesa"],[630,565,"diamond"],[1015,265,"mesa"]], [[190,165,0,"leaf"],[1050,640,3,"diamond"]], [[205,380,270,180],[665,300,350,410],[805,605,770,325]]),
    map(true, [[130,160,"diamond"],[265,380,"mesa"],[130,605,"diamond"],[265,815,"mesa"]], [[315,85,0,"leaf"],[75,385,1,"diamond"]], [[70,245,325,250],[320,465,75,475],[65,685,320,690]])),
];

/** Shorter question banks get an authored complete map, rather than empty quiz
 * islands or a trail that still visits removed stops. */
export const COMPACT_WORLD_MAP_LAYOUTS: readonly WorldMapLayout[] = [
  world(10, "fractions",
    map(false, [[260,500,"crescent"],[945,245,"ring"]], [[290,190,0,"diamond"],[900,590,1,"petal"]], [[280,270,670,90]]),
    map(true, [[135,260,"crescent"],[260,700,"ring"]], [[305,120,0,"diamond"],[75,815,1,"petal"]], [[250,320,85,485]])),
  world(12, "measurement",
    map(false, [[200,540,"terrace"],[555,170,"mesa"],[1010,530,"terrace"]], [[195,175,0,"leaf"],[640,560,2,"diamond"]], [[150,355,320,150],[725,130,1050,300]]),
    map(true, [[130,185,"terrace"],[265,485,"mesa"],[130,810,"terrace"]], [[315,105,0,"leaf"],[315,835,2,"diamond"]], [[75,305,330,305],[320,605,75,635]])),
  world(13, "market",
    map(false, [[205,190,"mesa"],[970,160,"bean"],[1005,525,"mesa"]], [[220,560,0,"cloud"],[600,350,1,"atoll"]], [[325,75,735,65],[1105,230,1120,430]]),
    map(true, [[125,190,"mesa"],[265,480,"bean"],[265,800,"mesa"]], [[315,95,0,"cloud"],[75,620,1,"atoll"]], [[85,305,330,310],[350,590,350,685]])),
  world(14, "clock",
    map(false, [[220,190,"ring"],[590,575,"petal"],[1010,230,"ring"]], [[195,595,0,"cloud"],[610,165,2,"diamond"]], [[150,395,375,650],[775,615,1115,445]]),
    map(true, [[265,190,"ring"],[265,495,"petal"],[125,810,"ring"]], [[75,110,0,"cloud"],[315,840,2,"diamond"]], [[350,290,350,390],[305,625,75,650]])),
  world(15, "area",
    map(false, [[230,225,"terrace"],[945,545,"diamond"]], [[970,190,1,"mesa"],[210,610,0,"terrace"]], [[500,200,750,370]]),
    map(true, [[260,260,"terrace"],[140,705,"diamond"]], [[75,120,0,"mesa"],[305,820,1,"terrace"]], [[340,400,70,515]])),
  world(26, "fractions",
    map(false, [[255,200,"ring"],[950,560,"crescent"]], [[215,610,0,"diamond"],[1010,145,1,"ring"]], [[265,455,650,650]]),
    map(true, [[260,245,"ring"],[130,715,"crescent"]], [[75,120,0,"diamond"],[315,820,1,"ring"]], [[95,330,330,535]])),
  world(28, "measurement",
    map(false, [[200,200,"mesa"],[575,555,"terrace"],[1010,190,"mesa"]], [[205,585,0,"diamond"],[590,170,2,"leaf"]], [[130,400,340,615],[785,610,1080,430]]),
    map(true, [[270,190,"mesa"],[130,480,"terrace"],[265,810,"mesa"]], [[75,105,0,"diamond"],[75,850,2,"leaf"]], [[325,290,65,305],[60,635,325,615]])),
  world(29, "market",
    map(false, [[205,190,"bean"],[1010,515,"mesa"],[400,570,"bean"]], [[1060,180,1,"atoll"],[195,540,2,"cloud"]], [[645,90,1070,245],[865,675,580,700]]),
    map(true, [[270,185,"bean"],[125,475,"mesa"],[125,810,"bean"]], [[75,100,0,"atoll"],[315,625,1,"cloud"]], [[325,300,60,315],[45,595,45,695]])),
  world(30, "clock",
    map(false, [[215,545,"petal"],[970,520,"ring"],[640,165,"petal"]], [[220,175,0,"diamond"],[640,600,1,"cloud"]], [[360,720,815,715],[1125,340,825,115]]),
    map(true, [[125,195,"petal"],[125,490,"ring"],[265,805,"petal"]], [[315,105,0,"diamond"],[75,860,2,"cloud"]], [[45,310,45,390],[80,620,325,640]])),
  world(31, "area",
    map(false, [[230,550,"diamond"],[970,205,"terrace"]], [[215,155,0,"mesa"],[955,610,1,"diamond"]], [[175,305,680,90]]),
    map(true, [[130,255,"diamond"],[265,710,"terrace"]], [[315,105,0,"mesa"],[75,825,1,"diamond"]], [[65,415,340,525]])),
];

export function getWorldMapLayout(worldNumber: number, stopCount = 4): WorldMapLayout {
  const layout = WORLD_MAP_LAYOUTS.find(candidate => candidate.worldNumber === worldNumber);
  if (!layout) throw new Error(`No authored map for Math World ${worldNumber}.`);
  if (stopCount === 4) return layout;
  const compact = COMPACT_WORLD_MAP_LAYOUTS.find(candidate => candidate.worldNumber === worldNumber && candidate.desktop.stopPoints.length === stopCount);
  if (compact) return compact;
  throw new Error(`No ${stopCount}-stop map for Math World ${worldNumber}.`);
}
