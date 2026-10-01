"use strict";
// Runs the extension against a mocked vortex-api and the live Hexium API.
// node test/test.js <folder with a Hexium zip named 5.0.6.zip (CLLC)>
const Module = require("module");
const path = require("path");
const assert = require("assert");

const dispatched = [];
const state = { persistent: { mods: { valheim: {} }, downloads: { files: {} } } };
const mockVortex = {
  actions: {
    setModAttribute: (gameId, modId, key, value) => ({ type: "SET_MOD_ATTRIBUTE", gameId, modId, key, value }),
    setModType: (gameId, modId, modType) => ({ type: "SET_MOD_TYPE", gameId, modId, modType }),
  },
  Icon: () => null,
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
      if (mod && a.type === "SET_MOD_ATTRIBUTE") mod.attributes[a.key] = a.value;
      if (mod && a.type === "SET_MOD_TYPE") mod.type = a.modType;
    },
  },
  sendNotification: (n) => notifications.push(n),
  showDialog: async () => ({ action: "Cancel", input: {} }),
  onAsync: (ev, fn) => { asyncListeners[ev] = fn; },
  events: {
    on: (ev, fn) => { (listeners[ev] ??= []).push(fn); },
    emit: (ev, ...args) => {
      emitted.push([ev, ...args]);
      const cb = args[ev === "start-download" ? 3 : ev === "start-install-download" ? 2 : ev === "purge-mods" ? 1 : 0];
      if (ev === "start-download") cb(null, "dl-1");
      if (ev === "start-install-download" || ev === "purge-mods" || ev === "deploy-mods") cb(null);
      for (const fn of listeners[ev] ?? []) fn(...args);
    },
  },
};
const registered = { actions: [], sources: [], extractors: [], once: [], installers: [], modTypes: [], pages: [] };
const context = {
  api,
  registerInstaller: (...a) => registered.installers.push(a),
  registerModType: (...a) => registered.modTypes.push(a),
  registerMainPage: (...a) => registered.pages.push(a),
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

  // ---- layout ----
  const L = require("../layout.js");
  const cllcFiles = ["CreatureLevelControl.dll", "icon.png", "Languages.zip", "README.md", "manifest.json"];
  assert.deepStrictEqual(L.buildInstructions(cllcFiles).map((i) => i.destination),
    ["BepInEx/plugins/CreatureLevelControl/CreatureLevelControl.dll", "BepInEx/plugins/CreatureLevelControl/Languages.zip"]);
  assert.deepStrictEqual(L.buildInstructions(["manifest.json", "plugins/Foo.dll", "config/foo.cfg", "patchers/P.dll"]).map((i) => i.destination),
    ["BepInEx/plugins/Foo.dll", "BepInEx/config/foo.cfg", "BepInEx/patchers/P.dll"]);
  // plugins/<rest> next to a root DLL joins its folder (More World Locations style)
  assert.deepStrictEqual(L.buildInstructions(["manifest.json", "MWL.dll", "plugins/Bundles/a.bundle"]).map((i) => i.destination),
    ["BepInEx/plugins/MWL/MWL.dll", "BepInEx/plugins/MWL/Bundles/a.bundle"]);
  // single container folder stripped
  assert.deepStrictEqual(L.buildInstructions(["Pkg/manifest.json", "Pkg/Pkg.dll", "Pkg/README.md"]).map((i) => i.destination),
    ["BepInEx/plugins/Pkg/Pkg.dll"]);
  assert.strictEqual(L.canPlace(["manifest.json", "winhttp.dll", "BepInEx/core/BepInEx.dll"]), false);
  assert.strictEqual(L.canPlace(["Foo.dll"]), false); // no manifest
  console.log("layout ok");

  // ---- installer ----
  const [instId, instPrio, test, install] = registered.installers[0];
  assert.strictEqual(instId, "hexium-package");
  assert.ok(instPrio < 20, "must run before the Thunderstore installer (20)");
  const dir = process.argv[2];
  state.persistent.downloads.files = {
    ours: { localPath: "Ours-Mod-1.0.0.zip", modInfo: { source: "hexium" } },
    ts: { localPath: "Ts-Mod-1.0.0.zip", modInfo: { source: "thunderstore" } },
    manual: { localPath: "5.0.6.zip", modInfo: {} },
  };
  assert.strictEqual((await test(cllcFiles, "valheim", path.join(dir, "Ours-Mod-1.0.0.zip"))).supported, true);
  assert.strictEqual((await test(cllcFiles, "valheim", path.join(dir, "Ts-Mod-1.0.0.zip"))).supported, false);
  assert.strictEqual((await test(cllcFiles, "valheim", path.join(dir, "5.0.6.zip"))).supported, true); // a Hexium release dropped in by hand
  assert.strictEqual((await test(cllcFiles, "skyrimse", path.join(dir, "Ours-Mod-1.0.0.zip"))).supported, false);
  const result = await install(cllcFiles, "C:/x", "valheim");
  assert.deepStrictEqual(result.instructions.at(-1), { type: "setmodtype", value: "hexium-valheim" });
  assert.strictEqual(registered.modTypes[0][0], "hexium-valheim");
  assert.strictEqual(registered.modTypes[0][5]?.name, "Hexium");
  console.log("installer ok");

  // ---- moving Thunderstore-typed Hexium mods to our type: purge, retype, deploy ----
  state.persistent.mods.valheim["old-cllc"].type = "thunderstore-valheim";
  state.persistent.mods.valheim["ts-mod"].type = "thunderstore-valheim";
  assert.deepStrictEqual(T.strayTypeMods(api, "valheim"), ["old-cllc"]);
  emitted.length = 0;
  await T.adoptTypes(api, "valheim");
  assert.deepStrictEqual(emitted.map((e) => e[0]), ["purge-mods", "deploy-mods"]);
  assert.strictEqual(state.persistent.mods.valheim["old-cllc"].type, "hexium-valheim");
  assert.strictEqual(state.persistent.mods.valheim["ts-mod"].type, "thunderstore-valheim");
  console.log("type move ok");

  // ---- browse page, rendered with React 18 (Vortex's version) ----
  const React = require("react");
  const TR = require("react-test-renderer");
  const [, title, Page, opts] = registered.pages[0];
  assert.strictEqual(title, "Browse Hexium");
  const props = opts.props();
  const installs = [];
  props.install = async (...a) => { installs.push(a); };
  let r;
  await TR.act(async () => { r = TR.create(React.createElement(Page, props)); });
  for (let i = 0; i < 100 && r.root.findAll((n) => n.type === "article").length === 0; i++) {
    await TR.act(() => new Promise((res) => setTimeout(res, 100)));
  }
  const text = (node) => (typeof node === "string" ? node : (node.children ?? []).map(text).join(""));
  const cards = () => r.root.findAll((n) => n.type === "article");
  assert.strictEqual(cards().length, 20);
  const countLine = r.root.findAll((n) => n.type === "span" && /mods on valheim\.hexium\.gg/.test(text(n)))[0];
  console.log("page:", text(countLine), "| first:", text(cards()[0].findAll((n) => n.props.className?.includes("font-semibold"))[0]));
  // search
  const search = r.root.find((n) => n.type === "input" && n.props.type === "search");
  await TR.act(async () => search.props.onChange({ target: { value: "CreatureLevelAndLootControl" } }));
  const cllcCard = () => cards().find((c) => text(c).startsWith("CreatureLevelAndLootControlSmoothbrain"));
  console.log("search hits:", cards().map((c) => text(c).slice(0, 40)).join(" | "));
  const cardText = text(cllcCard());
  assert.ok(cardText.includes("Smoothbrain") && cardText.includes("5.0.6"), cardText);
  // CLLC is "installed" twice in the mocked state: manual-cllc 5.0.6 -> Installed
  assert.ok(cardText.includes("Installed"), cardText);
  // a mod that isn't installed -> Install button that calls install(game, owner, name, version)
  await TR.act(async () => search.props.onChange({ target: { value: "Jewelcrafting" } }));
  const jc = cards().find((c) => text(c).includes("Smoothbrain"));
  const btnInstall = jc.find((n) => n.type === "button" && text(n) === "Install");
  await TR.act(async () => btnInstall.props.onClick());
  assert.strictEqual(installs[0][1], "Smoothbrain");
  assert.strictEqual(installs[0][2], "Jewelcrafting");
  assert.ok(text(jc).includes("Installed") || text(cards().find((c) => text(c).includes("Smoothbrain"))).includes("Installed"));
  // an older installed version -> Update button
  state.persistent.mods.valheim["manual-cllc"].attributes.fileId = "5.0.0";
  state.persistent.mods.valheim["old-cllc"].attributes.fileId = "5.0.0";
  await TR.act(async () => { r.update(React.createElement(Page, opts.props())); });
  const s2 = r.root.find((n) => n.type === "input" && n.props.type === "search");
  await TR.act(async () => s2.props.onChange({ target: { value: "CreatureLevelAndLootControl" } }));
  assert.ok(text(cllcCard()).includes("Update to 5.0.6"), text(cllcCard()));
  // category filter
  const cat = r.root.findAll((n) => n.type === "select")[0];
  await TR.act(async () => s2.props.onChange({ target: { value: "" } }));
  await TR.act(async () => cat.props.onChange({ target: { value: "Modpack" } }));
  console.log("category Modpack:", text(r.root.findAll((n) => n.type === "span" && /mods on/.test(text(n)))[0]));
  console.log("page ok");
  console.log("ALL OK");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
