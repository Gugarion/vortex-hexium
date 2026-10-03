Nexus Mods page text for the Hexium Vortex extension. Paste the BBCode below into the description field.

Name: Hexium Support for Vortex (unofficial)
Summary (short description field):
Browse, install and update mods from Hexium (hexium.gg) inside Vortex: Valheim and every other Hexium game whose mods use BepInEx.

----- description (BBCode) -----

[size=5][b]Hexium Support for Vortex[/b][/size]
[i]Unofficial. Not made by or affiliated with Hexium or Nexus Mods.[/i]

Some modders now publish on [url=https://hexium.gg]Hexium[/url] instead of (or as well as) Thunderstore; Smoothbrain's Valheim mods are one example, and Creature Level & Loot Control 5.x is only there. This extension lets Vortex install and update those mods like any other.

Source code (MIT): [url=https://github.com/Gugarion/vortex-hexium]github.com/Gugarion/vortex-hexium[/url]

[size=4][b]Features[/b][/size]
[list]
[*][b]Browse Hexium[/b] page in the left menu (for any supported game): search, category filter, sorting (most downloaded, recently updated, newest, name), pages of 20 / 50 / 100 mods with a jump-to-page box, Install / Update / Installed on every mod, and the other mods each one needs.
[*][b]Updates through Vortex's own Check for Updates[/b]: outdated Hexium mods get the normal update icon; clicking it (or Update All) installs the new version.
[*][b]Zips you downloaded by hand[/b]: drag a Hexium zip into Vortex and it is recognised (by its manifest) and linked to Hexium for update checks.
[*][b]Right-click → Link to Hexium / Unlink from Hexium[/b] for mods it can't recognise on its own.
[*][b]Open mod page[/b] goes to the mod's Hexium page.
[*]Own installer and mod type ("Hexium"). Files go where the Thunderstore extension puts them: BepInEx/plugins/<DLL name>/, config → BepInEx/config, patchers → BepInEx/patchers.
[/list]

[size=4][b]Requirements[/b][/size]
[list]
[*]Vortex 2.x with Valheim managed.
[*]A game Vortex manages that is on Hexium and whose mods use BepInEx: Valheim, Sunkenland, Burglin' Gnomes, How to Fish, Survival: Fountain of Youth, Last Pirates: Die Together (the list comes from Hexium, so new Hexium games are picked up). The game needs its own Vortex game extension. Kenshi and Primordialis are left out for now: their mods aren't BepInEx packages.
[*]Works with or without the Thunderstore extension. With it installed, Hexium downloads still use this extension's installer; Thunderstore downloads are never taken over.
[/list]

[size=4][b]Install[/b][/size]
Download with the Vortex button, or download the archive and drag it onto Vortex's Extensions page. Restart Vortex.

[size=4][b]Upgrading from Thunderstore-installed copies[/b][/size]
If a Hexium mod was installed by the Thunderstore extension earlier, it has the Thunderstore mod type. A notification offers "Switch to Hexium": it purges, changes the type and redeploys (files end up in the same place).

[size=4][b]Notes[/b][/size]
[list]
[*]BepInEx itself is left to the game's own Vortex extension.
[*]The mod list is cached for 5 minutes; use Refresh on the Browse page to reload it.
[/list]

[size=4][b]Source and bug reports[/b][/size]
[url=https://github.com/Gugarion/vortex-hexium]github.com/Gugarion/vortex-hexium[/url] (MIT license). Issues and pull requests welcome.

[size=4][b]Credits[/b][/size]
Hexium for its open, Thunderstore-compatible API. The Thunderstore extension for Vortex by Modding Forge, whose browse page this one's layout follows.
