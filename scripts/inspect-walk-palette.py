"""Read skin colours and register inexpensive render tints. Never edits PNGs.

Run after inspect-sprite-atlas.py. Samples the full head, excluding transparent
pixels and eyes. Each facing/carry group shares a reachable mean RGB colour.
"""
import json
import statistics
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / 'client/public/assets/characters/clayfolk'
names = ['resident-side-walk-v4', 'resident-walk-v2', 'resident-carry-walk-v2', 'resident-opposite-step-v3']
data = {name: json.loads((root / (name + '.json')).read_text()) for name in names}
images = {name: Image.open(root / (name + '.png')).convert('RGBA') for name in names}


def sample(name, index):
    frame = data[name]['frames'][index]
    pixels = []
    for y in range(frame['y'], round(frame['y'] + frame['height'] * .47)):
        for x in range(frame['x'], frame['x'] + frame['width']):
            r, g, b, a = images[name].getpixel((x, y))
            if a > 245 and r > g * 1.2 and g > b * 1.05:
                pixels.append((r, g, b))
    if len(pixels) < 30:
        raise ValueError(f'Insufficient skin pixels: {name}, {index}')
    return [round(statistics.mean(c)) for c in zip(*pixels)]


def register(frames, label):
    medians = [sample(*frame) for frame in frames]
    target = [min(c) for c in zip(*medians)]
    for (name, index), rgb in zip(frames, medians):
        channels = [min(255, round(255 * t / c)) for t, c in zip(target, rgb)]
        corrected = [round(c * t / 255) for c, t in zip(rgb, channels)]
        assert max(abs(a - b) for a, b in zip(corrected, target)) <= 1
        data[name]['frames'][index].update(tint=channels[0] << 16 | channels[1] << 8 | channels[2], skinSample=rgb, skinTarget=target)
    print(f'{label}: {medians} -> {target}')


for row in range(4):
    old = names[2 if row > 1 else 1]
    register([(names[0], row * 4 + key) for key in (0, 1, 3)] + [(old, 3 if row % 2 else 1)], f'side row {row}')

for carrying in range(2):
    old = names[1 + carrying]
    for column in (0, 2):
        register([(old, row * 4 + column) for row in range(data[old]['rows'])] + [(names[3], carrying * 4 + column)],
                 f'front/back {carrying}, {column}')

for name in names:
    (root / (name + '.json')).write_text(json.dumps(data[name], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
