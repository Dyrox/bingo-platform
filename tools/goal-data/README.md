# goal-data

Builds the goal list (names in English and Chinese, tiers, exclusive groups, icon recipes) and the icon images that the website draws cards and the tier guide with. Rerun when YAB or Minecraft updates.

Needs Python 3 with Pillow (`pip install pillow`).

## Inputs

Put everything in one working folder (call it `$W`):

| Path | What | Where from |
|---|---|---|
| `$W/jar/` | the YAB mod jar, unzipped | `bingo-<version>+mc<mc>.jar` |
| `$W/server/mc/` | the vanilla server, unzipped twice | `server.jar` is a launcher; unzip it, then unzip the jar under `META-INF/versions/` into `server/mc/` |
| `$W/client/` | the vanilla client jar, unzipped | e.g. ModrinthApp `meta/versions/<mc>-<loader>/<mc>-<loader>.jar` |
| `$W/zh_cn.json` | vanilla Simplified Chinese | not in any jar: the launcher downloads it; find `minecraft/lang/zh_cn.json` in the asset index (ModrinthApp `meta/assets/indexes/`) and copy that object from `meta/assets/objects/` |

Treat these as untrusted files: unzip into their own folders and run the scripts with `python3 -I` from elsewhere.

## Run

```bash
python3 -I tools/goal-data/build_data.py "$W" "$W/data.json" "$W/zh_cn.json"      # also writes data.json.ids
python3 -I tools/goal-data/build_icons.py "$W/client" "$W/jar" "$W/data.json.ids" "$W/icons.json"
cd web && node scripts/import-goals.mjs "$W/data.json" "$W/icons.json" <yab version, e.g. 2.15.1>
```

The last step writes `web/public/goals/<version>/` (goals.json + one PNG per icon) and adds the version to `web/public/goals/index.json`. Matches are drawn with the data for their own YAB release, so older releases stay as they are.

## What they do

- `build_data.py`: reads the tier lists (`items`, `advancements`, `challenge`, `simplified`, and Bingout's optional `draftout`), objective definitions and language files; resolves item tags; works out which goals the mod draws as "any of" stacks, "all of" grids or "never" goals. Draftout entries carry `draft: 1` for the guide and ban picker. Explicit goal pictures take priority over composite recipes.
- `build_icons.py`: renders every item from the client's models and textures (blocks as isometric cubes, flat items with tints), plus the mod's own goal pictures (including nested `draftout/` images) and the forbidden frame.

The `2.16.0` catalog was generated from `bingout-2.16.0-build.20261113163839736+mc26.3.jar` with Minecraft 26.3 assets. It contains all 406 goals in `draftout.tierlist.json`; the internal `draftout/placeholder` is not a playable goal. Import build releases under their base version (`2.16.0`): the website maps both timestamped and `build.dev` versions to it, while preserving `2.15.1` data for older matches. Run `cd web && npm test` to check version resolution and Draftout name/icon coverage.
