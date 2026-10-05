import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

import { chromium } from "playwright";

const basePath = "/nonverbal-reasoning-games";
const outputRoot = resolve(fileURLToPath(new URL("../../out/", import.meta.url)));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  // Next's static-export client navigation fetches these RSC payloads.
  ".txt": "text/x-component; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

let server;
let origin;
let browser;
let homepageScripts;

before(async () => {
  const homepage = await readFile(resolve(outputRoot, "index.html"), "utf8");
  homepageScripts = new Set(
    [...homepage.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)]
      .map((match) => new URL(match[1], "http://localhost").pathname),
  );
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (!pathname.startsWith(`${basePath}/`)) {
        response.writeHead(404).end();
        return;
      }
      let filename = resolve(outputRoot, pathname.slice(basePath.length + 1));
      if (filename !== outputRoot && !filename.startsWith(`${outputRoot}${sep}`)) {
        response.writeHead(404).end();
        return;
      }
      if ((await stat(filename)).isDirectory()) filename = resolve(filename, "index.html");
      response.writeHead(200, {
        "content-type": contentTypes[extname(filename)] ?? "application/octet-stream",
      });
      response.end(await readFile(filename));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

// Start a new quiet window after every action. waitForLoadState("networkidle")
// alone can return immediately if the page was idle before an observer fires.
async function settleRequestScheduling(page) {
  await new Promise((resolve, reject) => {
    let quietTimer;
    const cleanup = () => {
      clearTimeout(quietTimer);
      clearTimeout(deadline);
      page.off("request", restart);
    };
    const restart = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, 500);
    };
    // Bound a broken page that makes requests forever, matching Playwright's
    // operation timeout. This is a hang guard, not a responsiveness assertion.
    const deadline = setTimeout(() => {
      cleanup();
      reject(new Error("Browser requests never settled"));
    }, 30_000);
    page.on("request", restart);
    restart();
  });
  await page.waitForLoadState("networkidle");
}

async function mobileHome(t) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const pageErrors = [];
  const routeRequests = [];
  const extraScriptRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.startsWith(`${basePath}/`) &&
      /\/(?:games|lab|journey|math-world|question-search)(?:\/|\.txt$)/.test(pathname) &&
      pathname.endsWith(".txt")
    ) {
      routeRequests.push(pathname);
    }
    if (request.resourceType() === "script" && !homepageScripts.has(pathname)) {
      extraScriptRequests.push(pathname);
    }
  });
  await page.goto(`${origin}${basePath}/`);
  await settleRequestScheduling(page);
  await assertNoHorizontalOverflow(page);
  return { page, pageErrors, routeRequests, extraScriptRequests };
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  assert.ok(dimensions.content <= dimensions.viewport, JSON.stringify(dimensions));
}

function assertNoRoutePrefetch(routeRequests, extraScriptRequests) {
  assert.deepEqual(
    [...new Set(routeRequests)],
    [],
    "Browsing, hovering, and focusing the homepage must not fetch unopened routes",
  );
  assert.deepEqual(
    [...new Set(extraScriptRequests)],
    [],
    "Browsing must not load JavaScript beyond the exported homepage's scripts",
  );
}

async function assertActivatedRoute({ page, pageErrors, routeRequests, extraScriptRequests }, route, activate, heading) {
  assertNoRoutePrefetch(routeRequests, extraScriptRequests);
  await activate();
  await page.waitForURL(`${origin}${basePath}${route}`);
  await page.getByRole("heading", { name: heading }).waitFor();
  await settleRequestScheduling(page);
  // The selected page can have its own navigation links. Their prefetch policy
  // is outside this homepage regression; ensure the chosen route was fetched.
  assert.ok(
    routeRequests.some((pathname) => pathname.startsWith(`${basePath}${route}`)),
    "Activation must fetch the selected exported route",
  );
  await assertNoHorizontalOverflow(page);
  assert.deepEqual(pageErrors, []);
}

test("mobile shelf and labs stay idle until a game is tapped", { timeout: 90_000 }, async (t) => {
  const home = await mobileHome(t);
  const { page, routeRequests, extraScriptRequests } = home;
  await page.locator('a[href="#games"]').tap();
  const links = page.locator(".game-grid .game-link, .lab-grid .game-link, .journey-home-cta, .site-footer a[href^='/nonverbal-reasoning-games/']");
  assert.ok((await links.count()) > 0, "The exported catalog must have playable links");
  // Visit every card, including the labs below the shelf, using a phone viewport.
  for (const link of await links.all()) {
    await link.scrollIntoViewIfNeeded();
    await link.hover();
    await link.focus();
    await settleRequestScheduling(page);
  }
  assertNoRoutePrefetch(routeRequests, extraScriptRequests);
  await assertNoHorizontalOverflow(page);
  await assertActivatedRoute(
    home,
    "/games/rotation-match/",
    () => page.getByRole("link", { name: "Start a round of Transformation Match" }).tap(),
    "Transform it. Find it.",
  );
});

test("keyboard activation still opens a lab under the GitHub Pages base path", { timeout: 90_000 }, async (t) => {
  const home = await mobileHome(t);
  const link = home.page.locator(`a[href="${basePath}/lab/subtraction-trainer/"]`);
  await link.scrollIntoViewIfNeeded();
  await link.focus();
  await settleRequestScheduling(home.page);
  await assertActivatedRoute(
    home,
    "/lab/subtraction-trainer/",
    () => link.press("Enter"),
    /Subtraction, step by step\./,
  );
});

test("the Journey CTA waits for touch activation and still opens onboarding", { timeout: 90_000 }, async (t) => {
  const home = await mobileHome(t);
  const link = home.page.getByRole("link", { name: /Start your Journey/ });
  await link.hover();
  await link.focus();
  await settleRequestScheduling(home.page);
  await assertActivatedRoute(
    home,
    "/journey/",
    () => link.tap(),
    "Who is taking the trail?",
  );
});
