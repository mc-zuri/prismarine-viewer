## Bedrock preview

Six pages that show what the viewer draws of a Bedrock Edition version, with no server or world (but the recordings the replay plays):

* `world.html`: a small world of four biomes (plains, cherry grove, swamp, desert) with everything below together, and a tour of it: a house whose stairs roof turns its corners, fences and panes joining their neighbours, beds, banners, chests and heads shaped and coloured by their block entities, a farm, a waterfall and a pond, and villagers, a golem, animals, mobs and players moving about (walking, sneaking, swimming, gliding) with their names over them in the game's font; and the ender dragon sending fireballs at the ground, their breath trailing them and lingering where they land, and a skeleton shooting arrows (projectiles and particle effects)
* `replay.html`: a recording of a Bedrock client's packets played back: the world it was made in and its entities as the server told the client of them, with play, pause, speed and an entity for the camera to follow. The recordings are the `.proxy.bin` files of bedrock-observer and the proxy recorder, with the `world.json` of their world beside them; start the server with their directory (`node examples/bedrock_preview/server.js 3000 <directory>`) and install `bedrock-protocol`, which reads them. Its protocols are those of the minecraft-data it is installed with, found through that data's `dataPaths.json` (a checkout's generated `data.js` may be out of date); a client build that data has no version of is read with the nearest version before or after it that reads its packets
* `blocks.html`: every block state of a version in a grid (or those whose name matches a filter), the camera turning around them so that every side shows, and water, flowing water, grass and leaves in several biomes, each tinted as its biome tints it
* `entities.html`: every entity of a version, in the poses and movements the game animates: standing, walking, sprinting, sneaking, swimming, gliding... With what they hold in either hand and wear (armour, shields, tridents: the version's attachables), their variants, flags and entity properties (a cow's climate), and the players' skin: Steve and Alex, or a skin image of your own. The particle effects they start show as their animations say: a blaze's flames (charged), an evoker's spell (casting), a phantom's wing dust, a bee's nectar (its `has_nectar` property)
* `particles.html`: every particle effect of a version (its resource packs' particles), listed with how it plays, and filtered by name; those chosen play side by side in a grid, each under its name: those that loop or run on run on, those that end play again every few seconds, and those whose particles the game emits itself (of a manual rate) are given some all the time. Their particles land on the ground. `particles.html?version=bedrock_1.26.51&filter=flame&play=shown` plays those of a filter (`play=all`: every effect, or identifiers comma separated)

* `items.html`: every item icon of a version as minecraft-assets exports it (`items_textures.json`), and each aux variant of an item beside it (a bed's colours, a potion's effects, a legacy block item's kinds), drawn as the viewer draws a dropped item and as the game shows it in the inventory: the texture, its overlay over it, each multiplied by its colour (a leather helmet's dye, a spawn egg's colours). Every version minecraft-assets has is there, also those the viewer has no world for (0.14, 0.15, 1.0): the server serves the export itself. What may be wrong is marked: an item with no icon, a texture the export lacks, an icon the game dyes that nothing colours (its dyed part grey, what the dye leaves alone faint), and, to look at, block icons all grey (the game colours some, leaves and grass, most it does not). "check every version" lists all of that for every version at once; so does `node examples/bedrock_preview/itemCheck.js [versions...]`. `items.html?version=1.26.51&filter=leather&show=problems`

They build their worlds in the page, with minecraft-data of the chosen version only.

```bash
npm install                  # in the repository: builds the viewer and its assets into public/
npx webpack -c examples/bedrock_preview/webpack.config.js
node examples/bedrock_preview/server.js
```

Then open http://localhost:3000/. A page takes the version to show from its address too: `blocks.html?version=bedrock_1.21.130`.

The versions are those the viewer's assets are built for: the Bedrock versions minecraft-assets has assets of (see the main README).
