Nexus Mods page text for the Hexium Vortex extension. Paste the BBCode below into the description field.

Name: Hexium Support for Vortex (unofficial)
Summary (short description field):
Browse, install and update Valheim mods from Hexium (hexium.gg) inside Vortex, with Vortex's own Check for Updates.

----- description (BBCode) -----

[size=5][b]Hexium Support for Vortex[/b][/size]
[i]Unofficial. Not made by or affiliated with Hexium or Nexus Mods.[/i]

Some Valheim modders now publish on [url=https://valheim.hexium.gg]Hexium[/url] instead of (or as well as) Thunderstore; Smoothbrain's mods are one example, and Creature Level & Loot Control 5.x is only there. This extension lets Vortex install and update those mods like any other.

[size=4][b]Features[/b][/size]
[list]
[*][b]Browse Hexium[/b] page in the left menu: search, category filter, sorting (most downloaded, recently updated, newest, name), Install / Update / Installed on every mod, and the other mods each one needs.
[*][b]Updates through Vortex's own Check for Updates[/b]: outdated Hexium mods get the normal update icon; clicking it (or Update All) installs the new version.
[*][b]Zips you downloaded by hand[/b]: drag a Hexium zip into Vortex and it is recognised (by its manifest) and linked to Hexium for update checks.
[*][b]Right-click → Link to Hexium / Unlink from Hexium[/b] for mods it can't recognise on its own.
[*][b]Open mod page[/b] goes to the mod's Hexium page.
[*]Own installer and mod type ("Hexium"). Files go where the Thunderstore extension puts them: BepInEx/plugins/<DLL name>/, config → BepInEx/config, patchers → BepInEx/patchers.
[/list]

[size=4][b]Requirements[/b][/size]
[list]
[*]Vortex 2.x with Valheim managed.
[*]Valheim only for now (Hexium has a separate site per game).
[*]Works with or without the Thunderstore extension. With it installed, Hexium downloads still use this extension's installer; Thunderstore downloads are never taken over.
[/list]

[size=4][b]Install[/b][/size]
Download with the Vortex button, or download the archive and drag it onto Vortex's Extensions page. Restart Vortex.

[size=4][b]Upgrading from Thunderstore-installed copies[/b][/size]
If a Hexium mod was installed by the Thunderstore extension earlier, it has the Thunderstore mod type. A notification offers "Switch to Hexium": it purges, changes the type and redeploys (files end up in the same place).

[size=4][b]Notes[/b][/size]
[list]
[*]BepInExPack itself is left to Vortex's Valheim extension.
[*]The mod list is cached for 5 minutes; use Refresh on the Browse page to reload it.
[/list]

[size=4][b]Credits[/b][/size]
Hexium for its open, Thunderstore-compatible API. The Thunderstore extension for Vortex by Modding Forge, whose browse page this one's layout follows.
