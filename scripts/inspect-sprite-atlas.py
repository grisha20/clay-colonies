"""Read an RGBA atlas and write frame metadata. Never changes image pixels.

Usage: python scripts/inspect-sprite-atlas.py path/to/atlas.png [--columns 4 --rows 4]
Uses the largest connected alpha component in each cell, excluding isolated
generation speckles. The cell's horizontal root is retained across poses.
"""
import argparse
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("image", type=Path)
parser.add_argument("--columns", type=int, default=4)
parser.add_argument("--rows", type=int, default=4)
parser.add_argument("--head-anchors", action="store_true", help="Record a resident head's centre, forehead seat and width (read-only alpha inspection)")
parser.add_argument("--row-edges", help="Optional comma-separated inspected row boundaries for nonuniform generated gutters")
args = parser.parse_args()
im = Image.open(args.image).convert("RGBA")
alpha = im.getchannel("A")
w, h = im.size
row_edges = [int(v) for v in args.row_edges.split(',')] if args.row_edges else [round(i*h/args.rows) for i in range(args.rows+1)]
if len(row_edges) != args.rows+1 or row_edges[0] < 0 or row_edges[-1] > h or any(a >= b for a,b in zip(row_edges,row_edges[1:])):
    raise ValueError("Invalid row boundaries")
frames = []
for row in range(args.rows):
    for col in range(args.columns):
        x0, x1 = round(col * w / args.columns), round((col + 1) * w / args.columns)
        y0, y1 = row_edges[row], row_edges[row+1]
        tile = alpha.crop((x0, y0, x1, y1))
        tw, th = tile.size
        px, seen, largest = tile.load(), set(), []
        for y in range(th):
            for x in range(tw):
                if (x, y) in seen or px[x, y] < 32:
                    continue
                todo, component = [(x, y)], []
                seen.add((x, y))
                while todo:
                    xx, yy = todo.pop()
                    component.append((xx, yy))
                    for nx, ny in ((xx-1, yy), (xx+1, yy), (xx, yy-1), (xx, yy+1)):
                        if 0 <= nx < tw and 0 <= ny < th and (nx, ny) not in seen and px[nx, ny] >= 32:
                            seen.add((nx, ny))
                            todo.append((nx, ny))
                if len(component) > len(largest):
                    largest = component
        if len(largest) < 100:
            raise ValueError(f"Missing sprite at row {row}, column {col}")
        xs, ys = zip(*largest)
        bx, by = max(0, min(xs)-2), max(0, min(ys)-2)
        ex, ey = min(tw, max(xs)+3), min(th, max(ys)+3)
        frame = {"x": x0+bx, "y": y0+by, "width": ex-bx, "height": ey-by,
                 "anchorX": round((tw/2-bx)/(ex-bx), 6)}
        if args.head_anchors:
            head = [(x,y) for x,y in largest if y < by + (ey-by)*0.3]
            hx = [x for x,y in head]
            frame["head"] = {"x": (min(hx)+max(hx))/2-bx, "y": (ey-by)*0.27, "width": max(hx)-min(hx)+1}
        frames.append(frame)
result = {"imageWidth": w, "imageHeight": h, "columns": args.columns, "rows": args.rows, "frames": frames}
output = args.image.with_suffix(".json")
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"{output}: {w}x{h}, {len(frames)} frames, heights {min(f['height'] for f in frames)}..{max(f['height'] for f in frames)}")
