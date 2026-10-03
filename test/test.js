"use strict";
// Runs the extension against a mocked vortex-api and the live Hexium API.
// node test/test.js <folder with a Hexium zip named 5.0.6.zip (CLLC)>
const Module = require("module");
const path = require("path");
const assert = require("assert");

const dispatched = [];
const state = {
  persistent: { mods: { valheim: {}, sunkenland: {} }, downloads: { files: {} } },
  session: { gameMode: { known: [
    { id: "valheim", name: "Valheim" }, { id: "burglingnomes", name: "Burglin' Gnomes" }, { id: "sunkenland", name: "Sunkenland" },
    { id: "kenshi", name: "Kenshi" }, { id: "skyrimse", name: "Skyrim Special Edition" }, { id: "survivalfoy", name: "Survival: Fountain of Youth" },
  ] } },
};
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
  // right-click → Open on Hexium: only for one linked Hexium mod
  const openAction = registered.actions.find((a) => a[4] === "Open on Hexium");
  assert.ok(openAction);
  assert.strictEqual(openAction[6](["old-cllc"]), true);
  assert.strictEqual(openAction[6](["ts-mod"]), false);
  assert.strictEqual(openAction[6](["old-cllc", "manual-cllc"]), false);
  opened.length = 0;
  openAction[5](["old-cllc"]);
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
  assert.strictEqual(r.root.findAll((n) => n.type === "select").length, 0); // native selects are unreadable in Vortex's theme
  await TR.act(async () => s2.props.onChange({ target: { value: "" } }));
  const catButton = r.root.find((n) => n.type === "button" && n.props.title === "Category");
  await TR.act(async () => catButton.props.onClick());
  const option = r.root.find((n) => n.type === "button" && n.props.role === "option" && text(n) === "Modpack");
  await TR.act(async () => option.props.onClick());
  assert.strictEqual(r.root.findAll((n) => n.props?.role === "listbox").length, 0); // closed after picking
  assert.ok(text(r.root.find((n) => n.type === "button" && n.props.title === "Category")).includes("Modpack"));
  const sortButton = r.root.find((n) => n.type === "button" && n.props.title === "Sort");
  await TR.act(async () => sortButton.props.onClick());
  await TR.act(async () => r.root.find((n) => n.props.role === "option" && text(n) === "Name").props.onClick());
  assert.ok(text(r.root.find((n) => n.type === "button" && n.props.title === "Sort")).includes("Name"));
  console.log("category Modpack:", text(r.root.findAll((n) => n.type === "span" && /mods on/.test(text(n)))[0]));

  // paging: the section fills Vortex's body container absolutely so it scrolls by itself
  const section = r.root.find((n) => n.type === "section");
  assert.strictEqual(section.props.style.position, "absolute");
  assert.strictEqual(section.props.style.overflowY, "auto");
  await TR.act(async () => { r.update(React.createElement(Page, opts.props())); });
  const catAll = r.root.find((n) => n.type === "button" && n.props.title === "Category");
  await TR.act(async () => catAll.props.onClick());
  await TR.act(async () => r.root.find((n) => n.props.role === "option" && text(n) === "All categories").props.onClick());
  const total = Number(text(r.root.findAll((n) => n.type === "span" && /mods on/.test(text(n)))[0]).split(" ")[0].replace(/,/g, ""));
  const navs = () => r.root.findAll((n) => n.type === "nav");
  const pageOf = () => text(navs()[0].find((n) => n.type === "span" && /^Page \d+ of \d+$/.test(text(n))));
  assert.strictEqual(navs().length, 2); // above and below the list
  assert.strictEqual(pageOf(), `Page 1 of ${Math.ceil(total / 20)}`);
  const names = () => cards().map((c) => text(c.findAll((n) => n.props.className?.includes("font-semibold"))[0]));
  const first = names();
  await TR.act(async () => navs()[1].find((n) => n.props.title === "Next page").props.onClick());
  assert.strictEqual(pageOf(), `Page 2 of ${Math.ceil(total / 20)}`);
  assert.notDeepStrictEqual(names(), first);
  assert.strictEqual(cards().length, 20);
  await TR.act(async () => navs()[0].find((n) => n.props.title === "Page 1").props.onClick());
  assert.deepStrictEqual(names(), first);
  // jump box (7+ pages): bad input resets, good input jumps
  const jumpInput = () => navs()[0].find((n) => n.type === "input");
  const jumpForm = () => navs()[0].find((n) => n.type === "form");
  const last = Math.ceil(total / 20);
  await TR.act(async () => jumpInput().props.onChange({ target: { value: String(last + 5) } }));
  await TR.act(async () => jumpForm().props.onSubmit({ preventDefault() {} }));
  assert.strictEqual(pageOf(), `Page 1 of ${last}`);
  assert.strictEqual(jumpInput().props.value, "1");
  await TR.act(async () => jumpInput().props.onChange({ target: { value: String(last) } }));
  await TR.act(async () => jumpForm().props.onSubmit({ preventDefault() {} }));
  assert.strictEqual(pageOf(), `Page ${last} of ${last}`);
  assert.strictEqual(cards().length, total - (last - 1) * 20);
  assert.ok(navs()[0].find((n) => n.props.title === "Next page").props.disabled);
  // per page: 50 -> back to page 1, fewer pages
  await TR.act(async () => r.root.find((n) => n.type === "button" && n.props.title === "Mods per page").props.onClick());
  await TR.act(async () => r.root.find((n) => n.props.role === "option" && text(n) === "50 per page").props.onClick());
  assert.strictEqual(cards().length, Math.min(50, total));
  assert.strictEqual(pageOf(), `Page 1 of ${Math.ceil(total / 50)}`);
  // a filter change goes back to page 1
  await TR.act(async () => navs()[0].find((n) => n.props.title === "Next page").props.onClick());
  await TR.act(async () => r.root.find((n) => n.type === "input" && n.props.type === "search").props.onChange({ target: { value: "a" } }));
  assert.ok(navs().length === 0 || /^Page 1 of/.test(pageOf()));
  console.log(`paging ok (${total} mods, ${last} pages of 20)`);
  // Pager unit: hidden with one page, numbers around the current page
  const { Pager, pageNumbers } = require("../page.js");
  assert.strictEqual(TR.create(React.createElement(Pager, { cur: 1, count: 1, onPage: () => {} })).toJSON(), null);
  assert.deepStrictEqual(pageNumbers(10, 30), [1, "…", 9, 10, 11, "…", 30]);
  console.log("page ok");

  // ---- other Hexium games ----
  await require("../games.js").refresh(async (url) => JSON.parse((await new Promise((res, rej) => require("https").get(url, (r) => {
    let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej)))));
  assert.strictEqual(T.communityOf("valheim"), "valheim");
  assert.strictEqual(T.communityOf("burglingnomes"), "burglin-gnomes"); // id without dashes
  assert.strictEqual(T.communityOf("survivalfoy"), "sfoy");             // by name
  assert.strictEqual(T.communityOf("sunkenland"), "sunkenland");
  assert.strictEqual(T.communityOf("kenshi"), undefined);               // not BepInEx
  assert.strictEqual(T.communityOf("skyrimse"), undefined);
  assert.strictEqual(T.modTypeFor("valheim"), "hexium-valheim");
  assert.strictEqual(T.modTypeFor("sunkenland"), "hexium-bepinex");
  assert.strictEqual((await install(cllcFiles, "C:/x", "sunkenland")).instructions.at(-1).value, "hexium-bepinex");
  const sbt = registered.modTypes.find((m) => m[0] === "hexium-bepinex");
  assert.strictEqual(sbt[2]("sunkenland"), true);
  assert.strictEqual(sbt[2]("valheim"), false);
  assert.strictEqual(sbt[2]("skyrimse"), false);
  // update check against sunkenland.hexium.gg
  const sl = (await (await fetch("https://sunkenland.hexium.gg/api/experimental/package-index/")).text()).split(/\r?\n/).filter(Boolean).map(JSON.parse)
    .find((p) => !/BepInExPack/i.test(p.name));
  state.persistent.mods.sunkenland["sl-mod"] = { id: "sl-mod", attributes: T.linkAttributes("sunkenland", { namespace: sl.namespace, name: sl.name, version: "0.0.1" }) };
  assert.strictEqual(state.persistent.mods.sunkenland["sl-mod"].attributes.homepage, `https://sunkenland.hexium.gg/mods/${sl.namespace}/${sl.name}`);
  assert.deepStrictEqual(await asyncListeners["check-mods-version"]("sunkenland", state.persistent.mods.sunkenland), ["sl-mod"]);
  assert.strictEqual(state.persistent.mods.sunkenland["sl-mod"].attributes.newestVersion, sl.version_number);
  // its update downloads from Hexium with the game recorded for the attribute extractor
  emitted.length = 0;
  for (const fn of listeners["mod-update"]) fn("sunkenland", `${sl.namespace}/${sl.name}`, sl.version_number, "hexium");
  await new Promise((r) => setTimeout(r, 3000));
  const sdl = emitted.find((e) => e[0] === "start-download");
  assert.strictEqual(sdl[2].game, "sunkenland");
  assert.strictEqual(sdl[2].hexium.game, "sunkenland");
  const sattrs = await registered.extractors[0]({ download: { modInfo: sdl[2] } });
  assert.strictEqual(sattrs.homepage, `https://sunkenland.hexium.gg/mods/${sl.namespace}/${sl.name}`);
  // the Thunderstore-type move is Valheim only
  assert.deepStrictEqual(T.strayTypeMods(api, "sunkenland"), []);
  console.log("other games ok:", sl.namespace + "/" + sl.name, sl.version_number);
  console.log("ALL OK");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
