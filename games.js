"use strict";
// Which Hexium community (if any) a Vortex game is. Hexium runs one site per game, <identifier>.hexium.gg.
// The list comes from https://hexium.gg/api/experimental/community/ (refreshed at startup); the copy below is
// used until then or when Hexium can't be reached. A Vortex game matches a community by id
// ("valheim" = "valheim", "burglingnomes" = "burglin-gnomes") or by name ("Burglin' Gnomes" = "Burglin Gnomes").

const BUILTIN = [
  { identifier: "burglin-gnomes", name: "Burglin Gnomes" },
  { identifier: "how-to-fish", name: "How to Fish" },
  { identifier: "kenshi", name: "Kenshi" },
  { identifier: "last-pirates-die-together", name: "Last Pirates: Die Together" },
  { identifier: "primordialis", name: "Primordialis" },
  { identifier: "sunkenland", name: "Sunkenland" },
  { identifier: "sfoy", name: "Survival: Fountain of Youth" },
  { identifier: "valheim", name: "Valheim" },
];

// Communities whose mods aren't BepInEx packages (Kenshi: data mods; Primordialis: its own loader).
// Our installer only knows the BepInEx layout, so these are left out until it learns theirs.
const NOT_BEPINEX = new Set(["kenshi", "primordialis"]);

let communities = BUILTIN;

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function refresh(getJson) {
  try {
    const res = await getJson("https://hexium.gg/api/experimental/community/");
    const list = (res?.results ?? []).filter((c) => typeof c?.identifier === "string" && typeof c?.name === "string");
    if (list.length > 0) communities = list.map((c) => ({ identifier: c.identifier, name: c.name }));
  } catch {
    /* keep the last list */
  }
  return communities;
}

// The community for a Vortex game id (+ its display name), or undefined.
function communityFor(gameId, gameName) {
  if (!gameId) return undefined;
  return communities.find((c) => !NOT_BEPINEX.has(c.identifier) &&
    (c.identifier === gameId || norm(c.identifier) === norm(gameId) || (gameName && norm(c.name) === norm(gameName))));
}

const all = () => communities;

module.exports = { communityFor, refresh, all, NOT_BEPINEX, _set: (list) => { communities = list; } };
