"""Copies the finished HUD pictures from art/hud/ into the Godot project.

Only the game-size PNGs at the top of art/hud/ are copied (not _source/,
_preview/ or _tools/). 9-slice margins and cursor hotspots from
art/hud/manifest.csv go to godot/assets/ui/ui_meta.json, which HudArt reads.

    py -I scripts/godot/sync_hud_art.py
"""
import csv
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "art" / "hud"
DST = ROOT / "godot" / "assets" / "ui"


def ints(text: str) -> list[int]:
    return [int(v) for v in text.split(",")] if text.strip() else []


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    meta = {"slice": {}, "hotspot": {}}
    copied = 0
    with open(SRC / "manifest.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter=";"):
            name = row["file"]
            if "/" in name or not name.endswith(".png"):
                continue
            shutil.copyfile(SRC / name, DST / name)
            copied += 1
            key = name[:-4]
            if ints(row["slice"]):
                meta["slice"][key] = ints(row["slice"])
            if ints(row["hotspot"]):
                meta["hotspot"][key] = ints(row["hotspot"])
    (DST / "ui_meta.json").write_text(json.dumps(meta, indent=1, sort_keys=True), encoding="utf-8")
    print(f"copied {copied} pictures, {len(meta['slice'])} 9-slice, {len(meta['hotspot'])} cursors -> {DST}")


if __name__ == "__main__":
    main()
