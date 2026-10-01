"use strict";
// Hexium (hexium.gg) support for Vortex: browse and install mods from Hexium, link mods installed from a manually
// downloaded Hexium zip, and answer Vortex's own "Check for Updates" / update icon for them.
// Hexium's API is Thunderstore-shaped (/api/experimental/package/<namespace>/<name>/[<version>/]).

const https = require("https");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const layout = require("./layout");
const games = require("./games");
const { HexiumPage } = require("./page");

let vortex;
try { vortex = require("vortex-api"); } catch { vortex = require("@nexusmods/vortex-api"); }
const { actions, selectors, util } = vortex;
const log = (level, message, meta) => { try { vortex.log(level, `hexium: ${message}`, meta); } catch { /* no logger */ } };

const SOURCE = "hexium";
// Mod types: Valheim keeps the id 1.x installs already carry; every other Hexium game shares one.
const MOD_TYPE_VALHEIM = "hexium-valheim";
const MOD_TYPE_BEPINEX = "hexium-bepinex";
const modTypeFor = (gameId) => (gameId === "valheim" ? MOD_TYPE_VALHEIM : MOD_TYPE_BEPINEX);
// The Thunderstore extension's Valheim type (same layout, game root); Hexium mods it installed are moved to ours.
const THUNDERSTORE_TYPE = "thunderstore-valheim";
// Hexagon outline (MDI hexagon-outline) with a serif H inside, like Hexium's own icon.
const HEXAGON_MDI = "M21,16.5C21,16.88 20.79,17.21 20.47,17.38L12.57,21.82C12.41,21.94 12.21,22 12,22C11.79,22 11.59,21.94 11.43,21.82L3.53,17.38C3.21,17.21 3,16.88 3,16.5V7.5C3,7.12 3.21,6.79 3.53,6.62L11.43,2.18C11.59,2.06 11.79,2 12,2C12.21,2 12.41,2.06 12.57,2.18L20.47,6.62C20.79,6.79 21,7.12 21,7.5V16.5M12,4.15L5,8.09V15.91L12,19.85L19,15.91V8.09L12,4.15ZM7.4,7.5 L11,7.5 L11,8.7 L10.4,8.7 L10.4,11 L13.6,11 L13.6,8.7 L13,8.7 L13,7.5 L16.6,7.5 L16.6,8.7 L16,8.7 L16,15.3 L16.6,15.3 L16.6,16.5 L13,16.5 L13,15.3 L13.6,15.3 L13.6,13 L10.4,13 L10.4,15.3 L11,15.3 L11,16.5 L7.4,16.5 L7.4,15.3 L8,15.3 L8,8.7 L7.4,8.7Z";
// Set in main(); lets communityOf read Vortex's game names.
let apiRef;
const UA = "Vortex-Hexium/1.2.0 (+https://github.com/Gugarion/vortex-hexium)";

const vortexGameName = (gameId) => {
  try { return apiRef?.getState().session?.gameMode?.known?.find((g) => g.id === gameId)?.name; } catch { return undefined; }
};
// Hexium community (subdomain) of a Vortex game, undefined if Hexium has none we can install for.
const communityOf = (gameId) => games.communityFor(gameId, vortexGameName(gameId))?.identifier;
const communityName = (gameId) => games.communityFor(gameId, vortexGameName(gameId))?.name;
const baseUrl = (gameId) => `https://${communityOf(gameId)}.hexium.gg`;
const pageUrl = (gameId, namespace, name) => `${baseUrl(gameId)}/mods/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;

// ---------- http ----------

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": UA, Accept: "application/json" }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        resolve(request(new URL(res.headers.location, url).toString(), redirects + 1));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`timeout: ${url}`)));
    req.on("error", reject);
  });
}

async function getJson(url) {
  const res = await request(url);
  if (res.status === 404) return undefined;
  if (res.status !== 200) throw new Error(`Hexium answered ${res.status} for ${url}`);
  return JSON.parse(res.body);
}

const cache = new Map();
async function cached(key, ttlMs, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, until: Date.now() + ttlMs });
  return value;
}

const apiPackage = (gameId, ns, name) =>
  cached(`p:${gameId}:${ns}/${name}`, 60000, () =>
    getJson(`${baseUrl(gameId)}/api/experimental/package/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/`));

const apiVersion = (gameId, ns, name, version) =>
  cached(`v:${gameId}:${ns}/${name}/${version}`, 600000, () =>
    getJson(`${baseUrl(gameId)}/api/experimental/package/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/`));

// Every package with all its versions (~8 MB for Valheim), for the browse page.
const apiListing = (gameId, fresh = false) => {
  if (fresh) cache.delete(`l:${gameId}`);
  return cached(`l:${gameId}`, 300000, async () => {
    const list = await getJson(`${baseUrl(gameId)}/api/v1/package/`);
    if (!Array.isArray(list)) throw new Error("Hexium's package list was not a list");
    return list;
  });
};

// Newline-delimited JSON, latest version of every package.
const apiIndex = (gameId) =>
  cached(`i:${gameId}`, 600000, async () => {
    const res = await request(`${baseUrl(gameId)}/api/experimental/package-index/`);
    if (res.status !== 200) throw new Error(`Hexium answered ${res.status} for the package index`);
    return res.body.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
  });

// ---------- parsing ----------

// Accepts a Hexium page link, a gale://install/hexium/... link, "Namespace/Name[/version]" or a
// dependency string "Namespace-Name-1.2.3". Thunderstore-style names never contain '-'.
function parseRef(input) {
  const text = String(input ?? "").trim();
  if (text === "") return undefined;
  let m = /^gale:\/\/install\/hexium\/([^/]+)\/([^/]+)(?:\/([^/?#]+))?/i.exec(text);
  if (m) return { namespace: m[1], name: m[2], version: m[3] };
  m = /hexium\.gg\/mods\/([^/?#]+)\/([^/?#]+)(?:\/versions\/([^/?#]+))?/i.exec(text);
  if (m) return { namespace: decodeURIComponent(m[1]), name: decodeURIComponent(m[2]), version: m[3] && decodeURIComponent(m[3]) };
  m = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)-(\d+(?:\.\d+)*)$/.exec(text);
  if (m) return { namespace: m[1], name: m[2], version: m[3] };
  m = /^([A-Za-z0-9_]+)\/([A-Za-z0-9_]+)(?:\/(\d+(?:\.\d+)*))?$/.exec(text);
  if (m) return { namespace: m[1], name: m[2], version: m[3] };
  return undefined;
}

// Numeric compare of dotted versions ("1.10.0" > "1.9.3"); non-numeric parts compare as text.
function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/), pb = String(b).split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0", y = pb[i] ?? "0";
    const nx = /^\d+$/.test(x) ? parseInt(x, 10) : NaN, ny = /^\d+$/.test(y) ? parseInt(y, 10) : NaN;
    if (!isNaN(nx) && !isNaN(ny)) { if (nx !== ny) return nx < ny ? -1 : 1; }
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Reads one file out of a zip (stored or deflated) by its name, case-insensitive, any folder depth
// when `anyDepth`. Returns undefined if the archive isn't a zip or has no such file.
function readZipEntry(zipPath, wanted, anyDepth = false) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return undefined;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const target = wanted.toLowerCase();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return undefined;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/g, "/").toLowerCase();
    if (name === target || (anyDepth && name.endsWith("/" + target))) {
      const lNameLen = buf.readUInt16LE(local + 26), lExtraLen = buf.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      return undefined;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

function readManifest(zipPath) {
  try {
    const data = readZipEntry(zipPath, "manifest.json") ?? readZipEntry(zipPath, "manifest.json", true);
    if (data === undefined) return undefined;
    const json = JSON.parse(data.toString("utf8").replace(/^﻿/, ""));
    return typeof json.name === "string" && typeof json.version_number === "string" ? json : undefined;
  } catch (err) {
    log("debug", "no readable manifest", { zipPath, error: String(err) });
    return undefined;
  }
}

// ---------- vortex helpers ----------

const activeGame = (api) => { try { return selectors.activeGameId(api.getState()); } catch { return undefined; } };
const modsOf = (api, gameId) => api.getState().persistent?.mods?.[gameId] ?? {};
const isHexium = (mod) => mod?.attributes?.source === SOURCE && typeof mod.attributes.modId === "string";
const splitId = (modId) => { const i = modId.indexOf("/"); return { namespace: modId.slice(0, i), name: modId.slice(i + 1) }; };

function notify(api, type, message, id, displayMS = 6000, extra = {}) {
  api.sendNotification?.({ id: id ?? `hexium-${Date.now()}`, type, message, displayMS, ...extra });
}

function archivePathOf(api, gameId, mod) {
  const state = api.getState();
  const archiveId = mod?.archiveId;
  const download = archiveId ? state.persistent?.downloads?.files?.[archiveId] : undefined;
  if (!download?.localPath) return undefined;
  try { return path.join(selectors.downloadPathForGame(state, gameId), download.localPath); } catch { return undefined; }
}

function linkAttributes(gameId, info) {
  const modId = `${info.namespace}/${info.name}`;
  return {
    source: SOURCE,
    modId,
    fileId: info.version,
    version: info.version,
    author: info.namespace,
    homepage: pageUrl(gameId, info.namespace, info.name),
    hexium: { game: gameId, community: communityOf(gameId), namespace: info.namespace, name: info.name, version: info.version },
    ...(info.description ? { shortDescription: info.description } : {}),
    ...(info.icon ? { pictureUrl: info.icon } : {}),
  };
}

function setAttributes(api, gameId, modId, attrs) {
  for (const [key, value] of Object.entries(attrs)) api.store.dispatch(actions.setModAttribute(gameId, modId, key, value));
}

function emitAsync(api, event, ...args) {
  return new Promise((resolve, reject) => api.events.emit(event, ...args, (err, result) => (err ? reject(err) : resolve(result))));
}

// ---------- install / update ----------

async function installFromHexium(api, gameId, ref) {
  if (!communityOf(gameId)) throw new Error(`Hexium has no community for "${gameId}"`);
  let version = ref.version;
  if (!version) {
    const pkg = await apiPackage(gameId, ref.namespace, ref.name);
    if (!pkg) throw new Error(`${ref.namespace}/${ref.name} is not on ${communityOf(gameId)}.hexium.gg`);
    version = pkg.latest.version_number;
  }
  const v = await apiVersion(gameId, ref.namespace, ref.name, version);
  if (!v?.download_url) throw new Error(`${ref.namespace}/${ref.name} ${version} is not on Hexium`);
  const info = { namespace: v.namespace, name: v.name, version: v.version_number, description: v.description, icon: v.icon };
  const fileName = `${v.namespace}-${v.name}-${v.version_number}.zip`;
  const modId = `${v.namespace}/${v.name}`;
  const downloadId = await new Promise((resolve, reject) => {
    api.events.emit("start-download", [v.download_url], {
      game: gameId,
      source: SOURCE,
      name: v.name,
      modName: v.name,
      version: v.version_number,
      modVersion: v.version_number,
      author: v.namespace,
      description: v.description,
      homepage: pageUrl(gameId, v.namespace, v.name),
      pictureUrl: v.icon,
      fileName,
      ids: { modId, fileId: v.version_number },
      meta: { details: { modId, fileId: v.version_number } },
      hexium: { game: gameId, community: communityOf(gameId), ...info },
    }, fileName, (err, id) => (err ? reject(err) : id === undefined ? reject(new Error("Vortex returned no download id")) : resolve(id)),
    "never", { allowInstall: false });
  });
  await emitAsync(api, "start-install-download", downloadId, true);
  const deps = (v.dependencies ?? []).filter((d) => !/-BepInExPack[^-]*-[\d.]+$/i.test(d));
  notify(api, "success", `${v.name} ${v.version_number} installed from Hexium.` +
    (deps.length ? ` It also needs: ${deps.join(", ")}` : ""), `hexium-installed-${modId}`, deps.length ? 15000 : 6000);
}

async function updateMod(api, gameId, instanceId) {
  const mod = modsOf(api, gameId)[instanceId];
  if (!isHexium(mod)) return;
  const { namespace, name } = splitId(mod.attributes.modId);
  const version = mod.attributes.newestVersion;
  try {
    await installFromHexium(api, gameId, { namespace, name, version: typeof version === "string" ? version : undefined });
  } catch (err) {
    notify(api, "error", `Updating ${namespace}/${name} from Hexium failed: ${err.message ?? err}`, `hexium-update-failed-${instanceId}`, 10000);
  }
}

async function checkUpdates(api, gameId, modsToCheck) {
  if (!communityOf(gameId)) return [];
  const mods = modsOf(api, gameId);
  const ids = Object.keys(mods).filter((id) => isHexium(mods[id]) && (modsToCheck === undefined || id in modsToCheck));
  const outdated = [];
  await Promise.all(ids.map(async (id) => {
    const { namespace, name } = splitId(mods[id].attributes.modId);
    try {
      const pkg = await apiPackage(gameId, namespace, name);
      if (!pkg?.latest?.version_number) return;
      const newest = pkg.latest.version_number;
      const current = mods[id].attributes.fileId ?? mods[id].attributes.version;
      if (current !== undefined && compareVersions(newest, current) > 0) {
        setAttributes(api, gameId, id, { newestVersion: newest, newestFileId: newest });
        outdated.push(id);
      } else {
        setAttributes(api, gameId, id, { newestVersion: current, newestFileId: current });
      }
    } catch (err) {
      log("warn", "update check failed", { mod: `${namespace}/${name}`, error: String(err) });
      notify(api, "error", `Hexium update check for ${namespace}/${name} failed: ${err.message ?? err}`, `hexium-check-failed-${id}`, 8000);
    }
  }));
  return outdated;
}

// ---------- linking manually installed mods ----------

// Finds the Hexium package a mod's archive came from: manifest.json name + version, matched against
// the package index; the version must exist on Hexium. Returns {match} | {candidates} | {manifest} | {}.
async function matchArchive(api, gameId, mod) {
  const archive = archivePathOf(api, gameId, mod);
  if (!archive || path.extname(archive).toLowerCase() !== ".zip" || !fs.existsSync(archive)) return {};
  const manifest = readManifest(archive);
  if (!manifest) return {};
  const index = await apiIndex(gameId);
  const named = index.filter((p) => p.name.toLowerCase() === manifest.name.toLowerCase());
  const found = [];
  for (const p of named) {
    const v = await apiVersion(gameId, p.namespace, p.name, manifest.version_number);
    if (v) found.push({ namespace: v.namespace, name: v.name, version: v.version_number, description: v.description, icon: v.icon, size: v.file_size });
  }
  if (found.length === 1) return { manifest, match: found[0] };
  return { manifest, candidates: found };
}

function linkMod(api, gameId, modId, info) {
  setAttributes(api, gameId, modId, linkAttributes(gameId, info));
  log("info", "linked", { modId, to: `${info.namespace}/${info.name}`, version: info.version });
}

async function autoLink(api, gameId, modId) {
  if (!communityOf(gameId)) return;
  const mod = modsOf(api, gameId)[modId];
  if (!mod || (mod.attributes?.source && mod.attributes.source !== "")) return; // Nexus / Thunderstore / ours already
  try {
    const result = await matchArchive(api, gameId, mod);
    if (result.match) {
      linkMod(api, gameId, modId, result.match);
      notify(api, "info", `Linked ${result.match.name} ${result.match.version} to Hexium (${result.match.namespace}); it will be checked for updates.`,
        `hexium-linked-${modId}`, 8000);
    } else if (result.candidates?.length > 1) {
      notify(api, "info", `${result.manifest.name} ${result.manifest.version_number} is on Hexium from several authors: ` +
        `${result.candidates.map((c) => c.namespace).join(", ")}. Right-click it → "Link to Hexium" to choose.`, `hexium-ambiguous-${modId}`, 15000);
    }
  } catch (err) {
    log("warn", "auto-link failed", { modId, error: String(err) });
  }
}

async function linkDialog(api, gameId, modId) {
  const mod = modsOf(api, gameId)[modId];
  if (!mod) return;
  let guess = "", version = mod.attributes?.version ?? "";
  try {
    const result = await matchArchive(api, gameId, mod);
    const pick = result.match ?? result.candidates?.[0];
    if (pick) { guess = pageUrl(gameId, pick.namespace, pick.name); version = pick.version; }
    else if (result.manifest) version = result.manifest.version_number;
  } catch { /* fall through to manual entry */ }
  const name = mod.attributes?.customFileName ?? mod.attributes?.modName ?? mod.attributes?.name ?? modId;
  const res = await api.showDialog("question", "Link to Hexium", {
    text: `Which Hexium mod is "${name}"? Paste its Hexium page link (or Namespace/Name), and the version you have installed.`,
    input: [
      { id: "ref", type: "text", label: "Hexium page", value: guess, placeholder: `${baseUrl(gameId)}/mods/Author/ModName` },
      { id: "version", type: "text", label: "Installed version", value: version },
    ],
  }, [{ label: "Cancel" }, { label: "Link", default: true }]);
  if (res.action !== "Link") return;
  const ref = parseRef(res.input.ref);
  const installed = String(res.input.version ?? "").trim() || ref?.version;
  if (!ref || !installed) { notify(api, "warning", "Not linked: give a Hexium page link and the installed version."); return; }
  const pkg = await apiPackage(gameId, ref.namespace, ref.name);
  if (!pkg) { notify(api, "error", `${ref.namespace}/${ref.name} is not on ${communityOf(gameId)}.hexium.gg.`); return; }
  linkMod(api, gameId, modId, { namespace: pkg.namespace, name: pkg.name, version: installed, description: pkg.latest?.description, icon: pkg.latest?.icon });
  await checkUpdates(api, gameId, { [modId]: mod });
  notify(api, "success", `Linked to Hexium ${pkg.namespace}/${pkg.name} (installed ${installed}, newest ${pkg.latest?.version_number}).`);
}

function unlink(api, gameId, modId) {
  setAttributes(api, gameId, modId, {
    source: undefined, modId: undefined, fileId: undefined, newestVersion: undefined, newestFileId: undefined, hexium: undefined,
  });
}

// ---------- installer / mod type ----------

// The download record of an archive (the installer only gets the archive's path).
function downloadOf(api, archivePath) {
  if (!archivePath) return undefined;
  const name = path.basename(archivePath).toLowerCase();
  const files = api.getState().persistent?.downloads?.files ?? {};
  return Object.values(files).find((d) => typeof d?.localPath === "string" && path.basename(d.localPath).toLowerCase() === name);
}

// A zip dragged into Vortex by hand whose manifest name + version is a release on Hexium.
async function isHexiumRelease(gameId, archivePath) {
  if (!archivePath || path.extname(archivePath).toLowerCase() !== ".zip" || !fs.existsSync(archivePath)) return false;
  const manifest = readManifest(archivePath);
  if (!manifest) return false;
  const index = await apiIndex(gameId);
  for (const p of index.filter((x) => x.name.toLowerCase() === manifest.name.toLowerCase())) {
    if (await apiVersion(gameId, p.namespace, p.name, manifest.version_number)) return true;
  }
  return false;
}

async function testArchive(api, files, gameId, archivePath) {
  const no = { supported: false, requiredFiles: [] };
  if (!communityOf(gameId) || !layout.canPlace(files)) return no;
  const source = downloadOf(api, archivePath)?.modInfo?.source;
  if (source === SOURCE) return { supported: true, requiredFiles: [] };
  if (source) return no; // from Thunderstore, Nexus, ...: theirs, even if Hexium has the same release
  try {
    if (await isHexiumRelease(gameId, archivePath)) return { supported: true, requiredFiles: [] };
  } catch (err) {
    log("debug", "installer test could not reach Hexium", { archivePath, error: String(err) });
  }
  return no;
}

function gameRoot(api, gameId) {
  return api.getState().settings?.gameMode?.discovered?.[gameId]?.path;
}

// Hexium mods the Thunderstore extension installed before this one existed (same layout, other type).
function strayTypeMods(api, gameId) {
  const mods = modsOf(api, gameId);
  if (gameId !== "valheim") return [];
  return Object.keys(mods).filter((id) => isHexium(mods[id]) && mods[id].type === THUNDERSTORE_TYPE);
}

async function adoptTypes(api, gameId) {
  const ids = strayTypeMods(api, gameId);
  if (ids.length === 0) return;
  // Purge first: both types deploy to the game folder, and swapping a mod between them in one deployment
  // could let the old type remove files the new type just linked.
  await emitAsync(api, "purge-mods", false);
  for (const id of ids) api.store.dispatch(actions.setModType(gameId, id, MOD_TYPE_VALHEIM));
  await new Promise((resolve, reject) => api.events.emit("deploy-mods", (err) => (err ? reject(err) : resolve())));
  notify(api, "success", `Moved ${ids.length} Hexium mod(s) to the Hexium mod type and redeployed.`, "hexium-adopted");
}

function offerAdoption(api, gameId) {
  const ids = strayTypeMods(api, gameId);
  if (ids.length === 0) return;
  const mods = modsOf(api, gameId);
  const names = ids.map((id) => mods[id].attributes?.modName ?? mods[id].attributes?.name ?? id).join(", ");
  api.sendNotification?.({
    id: "hexium-adopt-types",
    type: "info",
    message: `${ids.length} Hexium mod(s) have the Thunderstore mod type: ${names}`,
    actions: [{
      title: "Switch to Hexium",
      action: (dismiss) => {
        dismiss();
        adoptTypes(api, gameId).catch((err) => notify(api, "error", `Switching mod types failed: ${err.message ?? err}`, "hexium-adopt-failed", 10000));
      },
    }],
  });
}

// ---------- registration ----------

function main(context) {
  const api = context.api;
  apiRef = api;
  const forActiveGame = () => communityOf(activeGame(api)) !== undefined;

  context.registerModSource(SOURCE, "Hexium", () => {
    const g = activeGame(api);
    util.opn(communityOf(g) ? `${baseUrl(g)}/` : "https://hexium.gg/").catch(() => undefined);
  }, {
    condition: forActiveGame,
  });

  // Mods downloaded through this extension carry `hexium` in the download's modInfo.
  context.registerAttributeExtractor(150, async (modInfo) => {
    const h = modInfo?.download?.modInfo?.hexium;
    if (!h || typeof h.namespace !== "string" || typeof h.name !== "string" || typeof h.version !== "string") return {};
    const gameId = typeof h.game === "string" ? h.game : modInfo?.download?.modInfo?.game ?? "valheim";
    return { ...linkAttributes(gameId, h), name: h.name, modName: h.name, logicalFileName: `${h.namespace}/${h.name}` };
  });

  // Before the Thunderstore extension's installer (20), which takes any Thunderstore-format zip.
  context.registerInstaller("hexium-package", 15,
    (files, gameId, archivePath) => testArchive(api, files, gameId, archivePath),
    async (files, destinationPath, gameId) => ({ instructions: [...layout.buildInstructions(files), { type: "setmodtype", value: modTypeFor(gameId) }] }));

  context.registerModType(MOD_TYPE_VALHEIM, 25, (gameId) => gameId === "valheim",
    (game) => gameRoot(api, game?.id ?? activeGame(api)), () => Promise.resolve(false), { name: "Hexium" });
  context.registerModType(MOD_TYPE_BEPINEX, 25, (gameId) => gameId !== "valheim" && communityOf(gameId) !== undefined,
    (game) => gameRoot(api, game?.id ?? activeGame(api)), () => Promise.resolve(false), { name: "Hexium" });

  context.registerMainPage("hexium", "Browse Hexium", HexiumPage, {
    id: "hexium",
    group: "per-game",
    mdi: HEXAGON_MDI,
    visible: forActiveGame,
    props: () => ({
      getGameId: () => activeGame(api),
      communityOf,
      communityName,
      loadPackages: (gameId, fresh) => apiListing(gameId, fresh),
      getInstalled: (gameId) => {
        const mods = modsOf(api, gameId);
        const map = new Map();
        for (const mod of Object.values(mods)) {
          if (!isHexium(mod)) continue;
          // several variants of one mod: the newest counts
          const key = mod.attributes.modId.toLowerCase(), v = mod.attributes.fileId ?? mod.attributes.version ?? "0";
          if (!map.has(key) || compareVersions(v, map.get(key)) > 0) map.set(key, v);
        }
        return map;
      },
      install: (gameId, namespace, name, version) => installFromHexium(api, gameId, { namespace, name, version }),
      compareVersions,
      openUrl: (url) => util.opn(url).catch(() => undefined),
    }),
  });

  context.registerAction("mods-action-icons", 300, "link", {}, "Link to Hexium",
    (ids) => { void linkDialog(api, activeGame(api), ids[0]); },
    (ids) => forActiveGame() && ids.length === 1 && !isHexium(modsOf(api, activeGame(api))[ids[0]]));

  context.registerAction("mods-action-icons", 301, "remove", {}, "Unlink from Hexium",
    (ids) => { const g = activeGame(api); for (const id of ids) unlink(api, g, id); },
    (ids) => forActiveGame() && ids.every((id) => isHexium(modsOf(api, activeGame(api))[id])));

  context.once(() => {
    void games.refresh(getJson);
    api.onAsync("check-mods-version", (gameId, mods) => checkUpdates(api, gameId, mods));

    api.events.on("mod-update", (gameId, modId, fileId, source) => {
      if (source !== SOURCE) return;
      const mods = modsOf(api, gameId);
      const id = Object.keys(mods).find((k) => isHexium(mods[k]) && mods[k].attributes.modId === modId);
      if (id !== undefined) void updateMod(api, gameId, id);
    });

    api.events.on("mods-update", async (gameId, modIds) => {
      const mods = modsOf(api, gameId);
      for (const id of modIds ?? []) if (isHexium(mods[id])) await updateMod(api, gameId, id);
    });

    api.events.on("open-mod-page", (gameId, modId, source) => {
      if (source !== SOURCE || typeof modId !== "string" || !communityOf(gameId)) return;
      const { namespace, name } = splitId(modId);
      util.opn(pageUrl(gameId, namespace, name)).catch(() => undefined);
    });

    api.events.on("did-install-mod", (gameId, archiveId, modId) => { void autoLink(api, gameId, modId); });

    const game = activeGame(api);
    if (communityOf(game)) setTimeout(() => offerAdoption(api, game), 5000);
    api.events.on("gamemode-activated", (gameId) => { if (communityOf(gameId)) setTimeout(() => offerAdoption(api, gameId), 5000); });
  });

  return true;
}

module.exports = {
  default: main,
  _test: { modTypeFor, communityOf, parseRef, compareVersions, readManifest, checkUpdates, matchArchive, installFromHexium, autoLink, linkAttributes, testArchive, apiListing, strayTypeMods, adoptTypes },
};
