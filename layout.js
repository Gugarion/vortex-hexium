"use strict";
// Where the files of a Hexium (Thunderstore-format) package go in the Valheim folder. Same destinations as
// the patched Thunderstore extension, so a mod moved between the two keeps its paths:
// - BepInEx/plugins|config|patchers/... and plugins|config|patchers/... at any depth keep that root;
// - plugins/<rest> next to a DLL at the package root joins that DLL's folder (as r2modman does);
// - other loose files go to BepInEx/plugins/<first DLL's name>/, loose .cfg files to BepInEx/config/;
// - manifest.json, README.md, CHANGELOG.md, icon.png are package metadata and are left out.
// Packages carrying BepInEx itself (winhttp.dll, doorstop, BepInEx/core) are refused: the Valheim game
// extension installs those.

const METADATA = new Set(["manifest.json", "readme.md", "changelog.md", "icon.png"]);
const ROOTS = ["plugins", "config", "patchers"];
const LOADER_FILES = new Set(["winhttp.dll", "doorstop_config.ini", ".doorstop_version", "start_game_bepinex.sh", "start_server_bepinex.sh"]);

const lower = (s) => s.toLowerCase();
const base = (p) => p.slice(p.lastIndexOf("/") + 1);
const ext = (p) => { const b = base(p); const i = b.lastIndexOf("."); return i < 0 ? "" : lower(b.slice(i)); };

function normalize(files) {
  return files
    .filter((f) => !f.endsWith("/") && !f.endsWith("\\"))
    .map((f) => ({ source: f, path: f.replace(/\\/g, "/").replace(/^\/+/, "") }))
    .filter((f) => f.path !== "");
}

function isLoader(p) {
  const parts = lower(p).split("/");
  const b = parts.indexOf("bepinex");
  return parts.includes("doorstop_libs") || (b >= 0 && parts[b + 1] === "core") || LOADER_FILES.has(parts[parts.length - 1]);
}

function stripContainer(files) {
  const payload = files.filter((f) => !METADATA.has(lower(base(f.path))));
  const tops = new Set(payload.map((f) => lower(f.path.split("/")[0])));
  if (tops.size !== 1) return files;
  const top = [...tops][0];
  if (top === "bepinex" || ROOTS.includes(top) || !payload.every((f) => f.path.includes("/"))) return files;
  return files.map((f) => (lower(f.path).startsWith(top + "/") ? { ...f, path: f.path.slice(top.length + 1) } : f));
}

function knownRoot(p) {
  const parts = p.split("/");
  const b = parts.findIndex((s) => lower(s) === "bepinex");
  if (b >= 0 && b < parts.length - 2 && ROOTS.includes(lower(parts[b + 1]))) {
    return ["BepInEx", lower(parts[b + 1]), ...parts.slice(b + 2)].join("/");
  }
  for (const root of ROOTS) {
    const i = parts.findIndex((s) => lower(s) === root);
    if (i >= 0 && i < parts.length - 1) return `BepInEx/${root}/${parts.slice(i + 1).join("/")}`;
  }
  return undefined;
}

function folderName(dllPath) {
  const name = base(dllPath).replace(/\.dll$/i, "").replace(/[<>:"/\\|?*]/g, "").replace(/[. ]+$/g, "").trim();
  if (!name || name === "." || name === "..") throw new Error("package has no usable plugin folder name");
  return name;
}

// Returns Vortex copy instructions, or throws when the archive isn't a package we can place.
function buildInstructions(files) {
  const all = normalize(files);
  if (!all.some((f) => lower(base(f.path)) === "manifest.json")) throw new Error("no manifest.json: not a Thunderstore-format package");
  if (all.some((f) => isLoader(f.path))) throw new Error("contains BepInEx itself; left to the Valheim extension");
  const payload = stripContainer(all).filter((f) => !METADATA.has(lower(base(f.path))));
  const firstDll = payload.find((f) => ext(f.path) === ".dll");
  const looseFolder = firstDll ? folderName(firstDll.path) : undefined;
  const rootDll = payload.find((f) => ext(f.path) === ".dll" && knownRoot(f.path) === undefined);
  const rootFolder = rootDll ? folderName(rootDll.path) : undefined;
  const seen = new Set();
  const out = [];
  for (const f of payload) {
    const parts = f.path.split("/");
    const colocated = rootFolder && parts.length > 1 && lower(parts[0]) === "plugins" ? `BepInEx/plugins/${rootFolder}/${parts.slice(1).join("/")}` : undefined;
    const dest = colocated ?? knownRoot(f.path) ??
      (ext(f.path) === ".cfg" ? `BepInEx/config/${f.path}` : looseFolder ? `BepInEx/plugins/${looseFolder}/${f.path}` : undefined);
    if (!dest) throw new Error(`don't know where ${f.path} goes`);
    if (seen.has(lower(dest))) throw new Error(`two files would land on ${dest}`);
    seen.add(lower(dest));
    out.push({ type: "copy", source: f.source, destination: dest });
  }
  if (out.length === 0) throw new Error("package has no installable files");
  return out;
}

function canPlace(files) {
  try { buildInstructions(files); return true; } catch { return false; }
}

module.exports = { buildInstructions, canPlace };
