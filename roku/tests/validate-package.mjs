import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function fail(message) {
  errors.push(message);
}

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function walk(path) {
  const absolute = resolve(root, path);
  return readdirSync(absolute).flatMap((name) => {
    const child = resolve(absolute, name);
    return statSync(child).isDirectory()
      ? walk(relative(root, child))
      : [relative(root, child).replaceAll("\\", "/")];
  });
}

const manifest = read("manifest");
if (!manifest.endsWith("\n")) fail("manifest must end with a newline");

const entries = new Map();
for (const rawLine of manifest.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) {
    fail(`invalid manifest line: ${rawLine}`);
    continue;
  }
  const key = line.slice(0, separator);
  const value = line.slice(separator + 1);
  if (entries.has(key)) fail(`duplicate manifest key: ${key}`);
  entries.set(key, value);
}

for (const key of [
  "title",
  "major_version",
  "minor_version",
  "build_version",
  "mm_icon_focus_hd",
  "mm_icon_focus_fhd",
  "splash_screen_hd",
  "splash_screen_fhd",
  "ui_resolutions",
]) {
  if (!entries.get(key)) fail(`missing manifest key: ${key}`);
}

for (const [key, value] of entries) {
  if (!value.startsWith("pkg:/")) continue;
  const path = value.slice("pkg:/".length);
  try {
    statSync(resolve(root, path));
  } catch {
    fail(`manifest ${key} points to missing file: ${path}`);
  }
}

const xmlFiles = walk("components").filter((path) => path.endsWith(".xml"));
const brsFiles = walk(".").filter((path) => path.endsWith(".brs"));
if (!xmlFiles.includes("components/PlezyScene.xml")) fail("PlezyScene.xml is missing");
if (!brsFiles.includes("source/main.brs")) fail("source/main.brs is missing");

const allSource = brsFiles.map(read).join("\n");
for (const marker of [
  "plexCreatePin",
  "jellyfinLogin",
  "CreatePlayback",
  "ReportProgress",
  "StandardKeyboardDialog",
  'PlayUrl(playback.url, "hls")',
]) {
  if (!allSource.includes(marker)) fail(`required Roku feature marker is missing: ${marker}`);
}

if (allSource.includes("pins?strong=true")) {
  fail("Plex TV linking must not use the strong PIN flow because plex.tv/link requires a four-character code");
}
if (!allSource.includes('JsonRequest("https://plex.tv/api/v2/pins", "POST"')) {
  fail("Plex TV linking must request the short-code PIN endpoint");
}
if (!allSource.includes("Len(code) <> 4")) {
  fail("Plex TV linking must reject non-four-character codes");
}

if (/EnablePeerVerification\s*\(\s*false/i.test(allSource)) {
  fail("TLS peer verification must not be disabled");
}
if (/EnableHostVerification\s*\(\s*false/i.test(allSource)) {
  fail("TLS host verification must not be disabled");
}
if (/localhost|127\.0\.0\.1/.test(allSource)) {
  fail("Roku source must not use a loopback server address");
}

const scene = read("components/PlezyScene.xml");
for (const id of ["providerButtons", "navList", "mediaGrid", "detailsView", "video", "apiTask"]) {
  if (!scene.includes(`id="${id}"`)) fail(`PlezyScene is missing node: ${id}`);
}

for (const componentName of ["MediaGridItem.xml", "PlezyScene.xml"]) {
  const component = read(`components/${componentName}`);
  const scriptIndex = component.indexOf("<script");
  const childrenIndex = component.indexOf("<children>");
  if (scriptIndex < 0 || childrenIndex < 0 || scriptIndex > childrenIndex) {
    fail(`${componentName}: <script> must appear before <children>`);
  }
  if (/<Button\b[^>]*\bwidth\s*=/.test(component)) {
    fail(`${componentName}: Button uses unsupported width field; use minWidth/maxWidth`);
  }
  if (/<Font\b[^>]*\buri\s*=\s*["']font:/.test(component)) {
    fail(`${componentName}: system fonts must be assigned through the parent node's font field`);
  }
}

if (errors.length) {
  console.error(`Roku validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Roku validation passed: ${brsFiles.length} BrightScript files, ${xmlFiles.length} SceneGraph components.`);
