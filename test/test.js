"use strict";
// Runs the extension against a mocked vortex-api and the live Hexium API.
// node test/test.js <folder with a Hexium zip named 5.0.6.zip (CLLC)>
const Module = require("module");
const path = require("path");
const assert = require("assert");

const dispatched = [];
const state = { persistent: { mods: { valheim: {} }, downloads: { files: {} } } };
const mockVortex = {
  actions: { setModAttribute: (gameId, modId, key, value) => ({ type: "SET_MOD_ATTRIBUTE", gameId, modId, key, value }) },
  selectors: { activeGameId: () => "valheim", downloadPathForGame: () => process.argv[2] },
  util: { opn: async (url) => { opened.push(url); } },
  log: () => {},
};
const opened = [];
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vortex-api") return "vortex-api";
  return origResolve.call(this, request, ...rest);
};
require.cache["vortex-api"] = { id: "vortex-api", filename: "vortex-api", loaded: true, exports: mockVortex };

const ext = require("../index.js");
const T = ext._test;

const listeners = {};
const asyncListeners = {};
const emitted = [];
const notifications = [];
const api = {
  getState: () => state,
  store: {
    dispatch: (a) => {
      dispatched.push(a);
      const mod = state.persistent.mods[a.gameId][a.modId];
      if (mod) mod.attributes[a.key] = a.value;
    },
  },
  sendNotification: (n) => notifications.push(n),
  showDialog: async () => ({ action: "Cancel", input: {} }),
  onAsync: (ev, fn) => { asyncListeners[ev] = fn; },
  events: {
    on: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
    emit: (ev, ...args) => {
      emitted.push([ev, ...args]);
      const cb = args[ev === "start-download" ? 3 : 2];
      if (ev === "start-download") cb(null, "dl-1");
      if (ev === "start-install-download") cb(null);
      for (const fn of listeners[ev] ?? []) fn(...args);
    },
  },
};
const registered = { actions: [], sources: [], extractors: [], once: [] };
const context = {
  api,
  registerModSource: (...a) => registered.sources.push(a),
  registerAttributeExtractor: (p, fn) => registered.extractors.push(fn),
  registerAction: (...a) => registered.actions.push(a),
  once: (fn) => registered.once.push(fn),
};

(async () => {
  // parseRef
  assert.deepStrictEqual(T.parseRef("https://valheim.hexium.gg/mods/Smoothbrain/CreatureLevelAndLootControl"),
    { namespace: "Smoothbrain", name: "CreatureLevelAndLootControl", version: undefined });
  assert.deepStrictEqual(T.parseRef("https://valheim.hexium.gg/mods/Smoothbrain/CreatureLevelAndLootControl/versions/5.0.5"),
    { namespace: "Smoothbrain", name: "CreatureLevelAndLootControl", version: "5.0.5" });
  assert.deepStrictEqual(T.parseRef("gale://install/hexium/Smoothbrain/CreatureLevelAndLootControl/5.0.6"),
    { namespace: "Smoothbrain", name: "CreatureLevelAndLootControl", version: "5.0.6" });
  assert.deepStrictEqual(T.parseRef("Smoothbrain-CreatureLevelAndLootControl-5.0.6"),
    { namespace: "Smoothbrain", name: "CreatureLevelAndLootControl", version: "5.0.6" });
  assert.deepStrictEqual(T.parseRef("Smoothbrain/Jewelcrafting"), { namespace: "Smoothbrain", name: "Jewelcrafting", version: undefined });
  assert.strictEqual(T.parseRef("hello world"), undefined);
  // compareVersions
  assert.strictEqual(T.compareVersions("5.0.6", "4.6.4"), 1);
  assert.strictEqual(T.compareVersions("1.10.0", "1.9.3"), 1);
  assert.strictEqual(T.compareVersions("1.0", "1.0.0"), 0);
  assert.strictEqual(T.compareVersions("1.0.2", "1.0.10"), -1);
  console.log("parse/compare ok");

  // manifest from a real Hexium zip
  const man = T.readManifest(path.join(process.argv[2], "5.0.6.zip"));
  assert.strictEqual(man.name, "CreatureLevelAndLootControl");
  assert.strictEqual(man.version_number, "5.0.6");
  console.log("manifest ok:", man.name, man.version_number);

  // registration
  ext.default(context);
  registered.once.forEach((fn) => fn());
  assert.strictEqual(registered.sources[0][0], "hexium");
  console.log("actions:", registered.actions.map((a) => `${a[0]}:${a[4]}`).join(", "));

  // a manually dropped zip (no source) gets linked after install
  state.persistent.downloads.files["arch-1"] = { localPath: "5.0.6.zip" };
  state.persistent.mods.valheim["manual-cllc"] = { id: "manual-cllc", archiveId: "arch-1", attributes: { name: "5.0.6" } };
  await T.autoLink(api, "valheim", "manual-cllc");
  const linked = state.persistent.mods.valheim["manual-cllc"].attributes;
  assert.strictEqual(linked.source, "hexium");
  assert.strictEqual(linked.modId, "Smoothbrain/CreatureLevelAndLootControl");
  assert.strictEqual(linked.fileId, "5.0.6");
  console.log("auto-link ok:", linked.modId, linked.fileId, "|", notifications.at(-1).message);

  // a Thunderstore/Nexus mod is never touched
  state.persistent.mods.valheim["ts-mod"] = { id: "ts-mod", archiveId: "arch-1", attributes: { source: "thunderstore", modId: "x/y" } };
  await T.autoLink(api, "valheim", "ts-mod");
  assert.strictEqual(state.persistent.mods.valheim["ts-mod"].attributes.source, "thunderstore");

  // update check through Vortex's event: an old version is flagged, the current one is not
  state.persistent.mods.valheim["old-cllc"] = { id: "old-cllc", attributes: T.linkAttributes("valheim",
    { namespace: "Smoothbrain", name: "CreatureLevelAndLootControl", version: "4.6.4" }) };
  const outdated = await asyncListeners["check-mods-version"]("valheim", state.persistent.mods.valheim);
  assert.deepStrictEqual(outdated, ["old-cllc"]);
  assert.strictEqual(state.persistent.mods.valheim["old-cllc"].attributes.newestFileId, "5.0.6");
  assert.strictEqual(state.persistent.mods.valheim["manual-cllc"].attributes.newestFileId, "5.0.6");
  assert.strictEqual(state.persistent.mods.valheim["ts-mod"].attributes.newestFileId, undefined);
  console.log("update check ok: outdated =", outdated);

  // other games are ignored
  assert.deepStrictEqual(await asyncListeners["check-mods-version"]("skyrimse", {}), []);

  // clicking the update icon downloads and installs the new version with our metadata
  emitted.length = 0;
  for (const fn of listeners["mod-update"]) fn("valheim", "Smoothbrain/CreatureLevelAndLootControl", "5.0.6", "hexium");
  for (const fn of listeners["mod-update"]) fn("valheim", "Smoothbrain/CreatureLevelAndLootControl", "5.0.6", "nexus"); // not ours
  await new Promise((r) => setTimeout(r, 3000));
  const dl = emitted.find((e) => e[0] === "start-download");
  assert.ok(dl, "no download started");
  assert.strictEqual(dl[1][0], "https://cdn.hexium.gg/upload/342/5.0.6.zip");
  assert.strictEqual(dl[3], "Smoothbrain-CreatureLevelAndLootControl-5.0.6.zip");
  assert.strictEqual(dl[2].hexium.namespace, "Smoothbrain");
  assert.ok(emitted.some((e) => e[0] === "start-install-download" && e[1] === "dl-1"));
  assert.strictEqual(emitted.filter((e) => e[0] === "start-download").length, 1);
  console.log("update install ok:", dl[1][0], "->", dl[3]);

  // the attribute extractor turns that download into a linked mod
  const attrs = await registered.extractors[0]({ download: { modInfo: dl[2] } });
  assert.strictEqual(attrs.source, "hexium");
  assert.strictEqual(attrs.modId, "Smoothbrain/CreatureLevelAndLootControl");
  assert.strictEqual(attrs.fileId, "5.0.6");
  assert.deepStrictEqual(await registered.extractors[0]({ download: { modInfo: { source: "nexus" } } }), {});
  console.log("extractor ok");

  // open mod page
  for (const fn of listeners["open-mod-page"]) fn("valheim", "Smoothbrain/CreatureLevelAndLootControl", "hexium");
  assert.deepStrictEqual(opened, ["https://valheim.hexium.gg/mods/Smoothbrain/CreatureLevelAndLootControl"]);
  console.log("open page ok");
  console.log("ALL OK");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
