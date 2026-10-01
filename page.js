"use strict";
// "Browse Hexium" main page: search, category filter, sort, paging, Install / Update / Installed per mod.
// Styled with the same Vortex classes the Thunderstore page uses.

const React = require("react");
let vortex;
try { vortex = require("vortex-api"); } catch { vortex = require("@nexusmods/vortex-api"); }
const Icon = vortex.Icon;
const h = React.createElement;

const PAGE_SIZE = 20;
const SORTS = [
  { value: "popular", label: "Most Downloaded" },
  { value: "updated", label: "Recently Updated" },
  { value: "new", label: "Newest" },
  { value: "name", label: "Name" },
];

function view(p) {
  const v = (p.versions ?? []).find((x) => x.is_active !== false) ?? p.versions?.[0];
  return {
    owner: p.owner, name: p.name, key: `${p.owner}/${p.name}`.toLowerCase(),
    url: p.package_url, version: v?.version_number, icon: v?.icon, description: v?.description ?? "",
    downloads: (p.versions ?? []).reduce((n, x) => n + (x.downloads ?? 0), 0),
    rating: p.rating_score ?? 0, updated: Date.parse(p.date_updated ?? "") || 0, created: Date.parse(p.date_created ?? "") || 0,
    categories: p.categories ?? [], deprecated: p.is_deprecated === true, nsfw: p.has_nsfw_content === true, pinned: p.is_pinned === true,
    dependencies: (v?.dependencies ?? []).filter((d) => !/^denikson-BepInExPack_Valheim-/i.test(d)),
  };
}

function short(n) {
  if (n < 1e3) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return `${(n / 1e6).toFixed(1)}m`;
}

function pageNumbers(cur, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  if (cur <= 4) return [1, 2, 3, 4, 5, "…", count];
  if (cur >= count - 3) return [1, "…", count - 4, count - 3, count - 2, count - 1, count];
  return [1, "…", cur - 1, cur, cur + 1, "…", count];
}

const btn = (kind) => `nxm-button nxm-button-${kind} nxm-button-sm`;
const iconBtn = "nxm-button nxm-button-neutral nxm-button-moderate nxm-button-icon-only";
const icon = (name) => h("span", { className: "nxm-button-icon" }, h(Icon, { name, className: "size-4" }));

function HexiumPage(props) {
  const { getGameId, communityName, loadPackages, getInstalled, install, compareVersions, openUrl } = props;
  const gameId = getGameId();
  const community = gameId === undefined ? undefined : communityName(gameId);
  const [all, setAll] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState();
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [sort, setSort] = React.useState("popular");
  const [showDeprecated, setShowDeprecated] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [refresh, setRefresh] = React.useState(0);
  const [busy, setBusy] = React.useState({});
  const [done, setDone] = React.useState({});
  const [installError, setInstallError] = React.useState();

  React.useEffect(() => {
    if (community === undefined) { setAll([]); return undefined; }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    loadPackages(gameId, refresh > 0)
      .then((list) => { if (!cancelled) setAll(list.map(view)); })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [gameId, community, refresh]);

  React.useEffect(() => setPage(1), [query, category, sort, showDeprecated]);

  if (community === undefined) {
    return h("section", { className: "h-full overflow-y-auto p-6" },
      h("h1", null, "Hexium"),
      h("p", null, gameId === undefined ? "Select a game first." : "Hexium has no mods for this game (supported: Valheim)."));
  }

  const installed = getInstalled(gameId);
  const categories = [...new Set(all.flatMap((p) => p.categories))].sort();
  const q = query.trim().toLowerCase();
  const shown = all
    .filter((p) => showDeprecated || !p.deprecated)
    .filter((p) => category === "" || p.categories.includes(category))
    .filter((p) => q === "" || `${p.owner}/${p.name} ${p.description} ${p.categories.join(" ")}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "updated") return b.updated - a.updated;
      if (sort === "new") return b.created - a.created;
      return b.downloads - a.downloads || b.rating - a.rating;
    });
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const cur = Math.min(page, pageCount);
  const visible = shown.slice((cur - 1) * PAGE_SIZE, cur * PAGE_SIZE);

  const doInstall = async (p) => {
    setBusy((b) => ({ ...b, [p.key]: true }));
    setInstallError(undefined);
    try {
      await install(gameId, p.owner, p.name, p.version);
      setDone((d) => ({ ...d, [p.key]: p.version }));
    } catch (e) {
      setInstallError(`${p.name}: ${e?.message ?? e}`);
    } finally {
      setBusy((b) => ({ ...b, [p.key]: false }));
    }
  };

  const actionButton = (p) => {
    if (p.version === undefined) return null;
    const have = done[p.key] ?? installed.get(p.key);
    if (busy[p.key]) return h("button", { type: "button", disabled: true, className: `${btn("primary nxm-button-strong")} nxm-button-disabled` }, "…");
    if (have !== undefined && compareVersions(p.version, have) <= 0) {
      return h("button", { type: "button", disabled: true, className: `${btn("neutral nxm-button-weak")} nxm-button-disabled`, title: `${have} is installed` },
        icon("checkbox-checked"), "Installed");
    }
    const update = have !== undefined;
    return h("button", {
      type: "button", className: btn("primary nxm-button-strong"), onClick: () => { void doInstall(p); },
      title: update ? `Update ${p.name} from ${have} to ${p.version}` : `Install ${p.name} ${p.version}`,
    }, update ? `Update to ${p.version}` : "Install");
  };

  const card = (p) => h("article", { key: p.key, className: "w-full rounded-md bg-surface-mid" },
    h("div", { className: "flex items-start gap-x-3.5 p-3" },
      h("div", { className: "relative aspect-collection w-full max-w-35 shrink-0 overflow-hidden rounded-xs bg-surface-translucent-mid" },
        p.icon ? h("img", { src: p.icon, alt: "", className: "size-full object-cover" })
          : h("div", { className: "flex size-full items-center justify-center text-primary-moderate text-heading-sm font-semibold" }, p.name.slice(0, 1).toUpperCase())),
      h("div", { className: "flex min-w-0 grow flex-col gap-y-1.5" },
        h("div", { className: "flex flex-col gap-y-1" },
          h("div", { className: "truncate font-semibold text-body-lg", title: p.name }, p.name),
          h("div", { className: "flex items-center gap-x-1 text-neutral-moderate text-body-sm" },
            h(Icon, { name: "author", className: "size-4" }), h("span", { className: "truncate" }, p.owner))),
        h("div", { className: "flex items-center gap-x-1.5 border-t border-stroke-weak pt-1.5 text-info-moderate text-body-sm", title: p.categories.join(", ") },
          h("span", { className: "truncate" }, p.categories.join(" · ") || "Hexium mod"),
          p.deprecated ? h("span", { className: "text-danger-strong" }, "Deprecated") : null),
        h("div", { className: "flex items-center gap-x-5 border-t border-stroke-weak pt-1.5 text-neutral-moderate text-body-sm" },
          h("span", { className: "flex items-center gap-x-1", title: "Stars" }, h(Icon, { name: "endorse-yes", className: "size-4 text-neutral-subdued" }), h("span", null, short(p.rating))),
          h("span", { className: "flex items-center gap-x-1", title: "Downloads" }, h(Icon, { name: "download", className: "size-4 text-neutral-subdued" }), h("span", null, short(p.downloads))),
          h("span", { className: "flex items-center gap-x-1", title: "Version" }, h(Icon, { name: "tags", className: "size-4 text-neutral-subdued" }), h("span", null, p.version ?? "—"))),
        h("div", { className: "line-clamp-3 border-t border-stroke-weak pt-1.5 text-neutral-subdued text-body-sm" }, p.description || "Hexium mod."),
        p.dependencies.length > 0
          ? h("div", { className: "text-neutral-subdued text-body-sm", title: p.dependencies.join("\n") }, `Needs: ${p.dependencies.map((d) => d.replace(/-[\d.]+$/, "")).join(", ")}`)
          : null)),
    h("div", { className: "flex shrink-0 items-center gap-x-2 rounded-b bg-surface-translucent-low px-3 py-2" },
      actionButton(p),
      p.url ? h("button", { type: "button", className: btn("neutral nxm-button-weak"), onClick: () => openUrl(p.url), title: `Open ${p.name} on Hexium` },
        icon("launch"), "View Page") : null));

  return h("section", { className: "h-full overflow-y-auto pt-6" },
    h("div", { className: "space-y-3 p-6" },
      h("div", { className: "flex flex-wrap items-center gap-2" },
        h("input", { type: "search", value: query, placeholder: "Search Hexium mods...", onChange: (e) => setQuery(e.target.value), className: "nxm-input max-w-60" }),
        h("select", { value: category, onChange: (e) => setCategory(e.target.value), className: "nxm-input max-w-60", title: "Category" },
          h("option", { value: "" }, "All categories"), ...categories.map((c) => h("option", { key: c, value: c }, c))),
        h("select", { value: sort, onChange: (e) => setSort(e.target.value), className: "nxm-input max-w-48", title: "Sort" },
          ...SORTS.map((s) => h("option", { key: s.value, value: s.value }, s.label))),
        h("label", { className: "flex items-center gap-x-1 text-body-sm text-neutral-moderate" },
          h("input", { type: "checkbox", checked: showDeprecated, onChange: (e) => setShowDeprecated(e.target.checked) }), "Show deprecated"),
        h("button", { type: "button", className: iconBtn, title: "Refresh", onClick: () => setRefresh((r) => r + 1) }, icon("refresh")),
        h("span", { className: "text-translucent-moderate text-body-sm" }, `${shown.length.toLocaleString("en-US")} mods on ${community}.hexium.gg`)),
      loading ? h("div", { className: "p-5 text-center text-neutral-subdued text-body-sm" }, "Loading Hexium mods …") : null,
      error !== undefined ? h("div", { className: "p-5 text-center text-danger-strong text-body-sm", role: "alert" }, `Could not load Hexium's mod list: ${error}`) : null,
      installError !== undefined ? h("div", { className: "p-2.5 text-danger-strong text-body-sm", role: "alert" }, `Installation failed: ${installError}`) : null,
      !loading && error === undefined
        ? h("div", { className: "grid grid-cols-[repeat(auto-fit,minmax(26rem,1fr))] gap-4" },
          visible.length === 0 ? h("div", { className: "p-5 text-center text-neutral-subdued text-body-sm" }, "No mods match your search.") : null,
          ...visible.map(card))
        : null,
      pageCount > 1
        ? h("nav", { className: "nxm-pagination" },
          h("div", { className: "nxm-pagination-items" },
            h("button", { type: "button", className: "nxm-pagination-arrow", disabled: cur === 1, onClick: () => setPage(cur - 1), title: "Previous page" },
              h(Icon, { name: "collection-previous", className: "size-4" })),
            ...pageNumbers(cur, pageCount).map((n, i) => (n === "…"
              ? h("span", { key: `e${i}`, className: "nxm-pagination-separator" }, "...")
              : h("button", { key: n, type: "button", className: `nxm-pagination-number ${n === cur ? "nxm-pagination-number-active" : ""}`, onClick: () => setPage(n) }, n))),
            h("button", { type: "button", className: "nxm-pagination-arrow", disabled: cur === pageCount, onClick: () => setPage(cur + 1), title: "Next page" },
              h(Icon, { name: "collection-next", className: "size-4" }))))
        : null));
}

module.exports = { HexiumPage, view };
