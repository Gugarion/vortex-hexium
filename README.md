# Hexium Support for Vortex

*Unofficial. Not made by or affiliated with Hexium or Nexus Mods.*

A [Vortex](https://www.nexusmods.com/about/vortex/) extension that browses, installs and updates mods from
[Hexium](https://hexium.gg), for every Hexium game whose mods use BepInEx and that Vortex manages
(Valheim, Sunkenland, Burglin' Gnomes, How to Fish, Survival: Fountain of Youth, ...).

## Features

- **Browse Hexium** page: search, category filter, sorting, Install / Update / Installed on every mod, and the
  mods each one needs.
- **Updates through Vortex's own Check for Updates**: outdated Hexium mods get the normal update icon.
- **Hand-downloaded zips**: a Hexium zip dragged into Vortex is recognised by its `manifest.json` and linked to
  Hexium for update checks. Right-click → *Link to Hexium* / *Unlink from Hexium* for the rest.
- **Open mod page** goes to the Hexium page.
- Own installer and mod type ("Hexium"): `BepInEx/plugins/<DLL name>/`, `config` → `BepInEx/config`,
  `patchers` → `BepInEx/patchers`, the same places as the Thunderstore extension for Vortex. BepInEx itself is
  left to the game's own Vortex extension.

## Games

The list of games comes from Hexium (`https://hexium.gg/api/experimental/community/`). A Vortex game is matched to
a Hexium community by id (`burglingnomes` = `burglin-gnomes`) or by name. The game also needs its own Vortex game
extension. Kenshi and Primordialis are left out for now: their mods aren't BepInEx packages.

## Install

From Nexus Mods with Vortex, or drop a release zip onto Vortex's Extensions page and restart Vortex.
By hand: copy `info.json` and the `.js` files into `%APPDATA%\Vortex\plugins\Hexium` (`install.ps1` does that).

## Files

| File | |
|---|---|
| `index.js` | registration, Hexium API, installer, update checks, linking |
| `games.js` | Vortex game ↔ Hexium community |
| `layout.js` | where a package's files go |
| `page.js` | the Browse Hexium page (React, Vortex's classes) |
| `test/test.js` | runs everything against a mocked Vortex and the live Hexium API |

## Tests

```
npm i react@18.3.1 react-test-renderer@18.3.1     # Vortex 2.x ships React 18.3.1
NODE_PATH=<that node_modules> node test/test.js <folder with Smoothbrain's CLLC 5.0.6 zip saved as 5.0.6.zip>
```

## License

MIT, see [LICENSE](LICENSE).
