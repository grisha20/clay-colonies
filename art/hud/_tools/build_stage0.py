"""Build only the six stage-0 samples. Python 3.11 + Pillow; no game runtime."""
import argparse
import csv
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance, ImageChops
import raster_pipeline as raster

ROOT = Path(__file__).resolve().parents[1]
SPECS = {
    'res_clay': ((128, 128), 'res', 'Глина', 'game_hud.gd · ResourceBar'),
    'res_wood': ((128, 128), 'res', 'Дерево', 'game_hud.gd · ResourceBar'),
    'glyph_pause': ((48, 48), 'glyph', 'Пауза — отдельный глиф', 'Правая верхняя панель'),
    'build_hut': ((128, 112), 'build', 'Хижина', 'Нижняя панель построек'),
    'btn_square_normal': ((64, 64), 'btn', 'Квадратная кнопка — проба normal', 'Общая рамка кнопок'),
    'cursor_default': ((64, 64), 'cursor', 'Обычный курсор', 'Указатель мыши'),
}
PAPER, DARK, INK = '#F2E3BD', '#2B2118', '#4D331F'
RESAMPLE = Image.Resampling.LANCZOS


def font(size, bold=False):
    name = 'arialbd.ttf' if bold else 'arial.ttf'
    try:
        return ImageFont.truetype(str(Path('C:/Windows/Fonts') / name), size)
    except OSError:
        return ImageFont.load_default()


def clean_alpha(im):
    # Generated solid interiors often arrive at 253/255; normalize that coverage.
    import numpy as np
    data=np.array(im.convert('RGBA'))
    alpha=data[:,:,3]
    alpha[alpha<8]=0
    alpha[alpha>=240]=255
    rgb=data[:,:,:3]
    white=(alpha>0)&(alpha<255)&(rgb.min(axis=2)>235)&(rgb.max(axis=2)-rgb.min(axis=2)<20)
    alpha[white]=0
    data[alpha==0]=(0,0,0,0)
    return Image.fromarray(data)


def fit_asset(im, size, margin):
    im = clean_alpha(im)
    bbox = im.getchannel('A').getbbox()
    if bbox is None:
        raise ValueError('Empty generated asset')
    cut = im.crop(bbox)
    cut.thumbnail((size[0] - margin * 2, size[1] - margin * 2), RESAMPLE)
    result = Image.new('RGBA', size)
    result.alpha_composite(cut, ((size[0] - cut.width) // 2, (size[1] - cut.height) // 2))
    return clean_alpha(result)


def nine_slice(im, size, inset):
    w, h = im.size
    tw, th = size
    l, t, r, b = inset
    result = Image.new('RGBA', size)
    sx, sy = [0, l, w-r, w], [0, t, h-b, h]
    dx, dy = [0, l, tw-r, tw], [0, t, th-b, th]
    for y in range(3):
        for x in range(3):
            piece = im.crop((sx[x], sy[y], sx[x+1], sy[y+1]))
            result.paste(piece.resize((dx[x+1]-dx[x], dy[y+1]-dy[y]), RESAMPLE), (dx[x], dy[y]))
    return result


def outlined_asset(im, size):
    return raster.icon(im, size)


def make_cursor(im):
    return raster.cursor(im)


def make_button(im):
    return raster.panel(im,(64,64),(16,16,16,16))


def paste_center(canvas, im, box):
    x, y, w, h = box
    canvas.alpha_composite(im, (x + (w-im.width)//2, y + (h-im.height)//2))


def make_board(images):
    board = Image.new('RGBA', (1560, 1260), PAPER)
    d = ImageDraw.Draw(board)
    d.text((40, 26), 'CLAYFOLK / HUD', font=font(32, True), fill=INK)
    d.text((40, 72), 'Стиль одобрен · плотный контур · исправленное остриё', font=font(21), fill=INK)
    palette = ['#F2E3BD', '#4D331F', '#8C6138', '#D66C34', '#5C8C33', '#3F8FD0', '#F0B85A']
    for i, c in enumerate(palette):
        d.rounded_rectangle((1030+i*68, 30, 1084+i*68, 62), radius=6, fill=c, outline=INK)
    for idx, (name, (size, group, title, where)) in enumerate(SPECS.items()):
        col, row = idx % 3, idx // 3
        x, y = 40 + col*505, 124 + row*450
        d.text((x, y), name+'.png', font=font(22, True), fill=INK)
        d.text((x, y+32), f'{title} · {size[0]}×{size[1]}', font=font(17), fill=INK)
        d.rectangle((x, y+70, x+475, y+285), fill=DARK)
        d.rectangle((x, y+70, x+236, y+285), fill=PAPER)
        d.rectangle((x, y+70, x+475, y+285), outline='#B69A70', width=1)
        im = images[name]
        if name == 'btn_square_normal':
            display = im.resize((144, 144), RESAMPLE)
        else:
            ratio = min(184/im.width, 184/im.height)
            display = im.resize((round(im.width*ratio), round(im.height*ratio)), RESAMPLE)
        paste_center(board, display, (x, y+78, 236, 180))
        paste_center(board, display, (x+238, y+78, 236, 180))
        d.text((x+12, y+263), 'Светлый фон', font=font(14), fill=INK)
        d.text((x+250, y+263), 'Тёмный фон', font=font(14), fill=PAPER)
        d.text((x, y+302), '1:1', font=font(15, True), fill=INK)
        paste_center(board, im, (x+38, y+297, 136, 132))
        if group in ('res', 'build', 'glyph', 'cursor'):
            small = im.copy()
            small.thumbnail((24, 24), RESAMPLE)
            small.save(ROOT/'_preview'/f'{name}_24.png')
            d.text((x+200, y+302), '24 px', font=font(15, True), fill=INK)
            paste_center(board, small, (x+210, y+335, 40, 40))
            d.rectangle((x+265, y+328, x+315, y+378), fill=DARK)
            paste_center(board, small, (x+270, y+333, 40, 40))
        else:
            d.text((x+200, y+302), '9-slice · 16,16,16,16', font=font(15), fill=INK)
            board.alpha_composite(nine_slice(im, (244, 64), (16,16,16,16)), (x+200, y+340))
    d.line((40, 1050, 1518, 1050), fill='#B69A70', width=2)
    d.text((40, 1070), 'Проверка сборки: рамка + отдельный глиф / растяжение 9-slice', font=font(21, True), fill=INK)
    button = images['btn_square_normal']
    pause = images['glyph_pause']
    composed = button.copy()
    composed.alpha_composite(pause, (8, 8))
    board.alpha_composite(composed, (44, 1120))
    for i, size in enumerate([(128,64), (64,96), (192,64)]):
        board.alpha_composite(nine_slice(button, size, (16,16,16,16)), (150+i*230, 1120))
    d.text((900, 1133), 'Без текста внутри игровых ассетов.', font=font(19), fill=INK)
    d.text((900, 1166), 'Курсор: hotspot (4,4). Светлые глифы — на sheet_glyph.', font=font(17), fill=INK)
    board.save(ROOT/'_preview'/'style_board.png')
    # Per-group review sheets, including both backgrounds and the 24 px views.
    for group in dict.fromkeys(s[1] for s in SPECS.values()):
        indices = [i for i, (_, s) in enumerate(SPECS.items()) if s[1] == group]
        sheet = Image.new('RGBA', (505*len(indices), 450), PAPER)
        for n, i in enumerate(indices):
            x, y = 40+(i%3)*505, 124+(i//3)*450
            sheet.paste(board.crop((x,y,x+495,y+440)), (n*505+5,5))
        sheet.save(ROOT/'_preview'/f'sheet_{group}.png')


def manifest(prompts):
    rows = []
    for path in sorted(ROOT.rglob('*.png')):
        rel = path.relative_to(ROOT).as_posix()
        name = path.stem
        is_source = rel.startswith('_source/')
        if name in SPECS and (is_source or '/' not in rel):
            _, group, title, where = SPECS[name]
            group = 'source' if is_source else group
            prompt = prompts[name]
            if not is_source:
                prompt += ' | Postprocess: build_stage0.py (alpha crop, proportional Lanczos fit, consistent dark outline; pause darkening; button stretch-zone flattening; cursor tip sharpening).'
        else:
            group, title, where = 'preview', 'Превью — '+name, 'Только художественная проверка, не импортировать в игру'
            prompt = 'Composited by _tools/build_stage0.py from the six generated stage-0 samples.'
        size = Image.open(path).size
        rows.append([rel, group, title, where, f'{size[0]}x{size[1]}', 'normal' if name=='btn_square_normal' and not is_source else '', '16,16,16,16' if name=='btn_square_normal' and not is_source else '', '4,4' if name=='cursor_default' and not is_source else '', prompt])
    with (ROOT/'manifest.csv').open('w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f, delimiter=';')
        writer.writerow(['file','group','title_ru','where','size','states','slice','hotspot','prompt'])
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--import-generated', type=Path, help='JSON mapping asset name to generated PNG path')
    args = parser.parse_args()
    for folder in ('_source', '_preview'):
        (ROOT/folder).mkdir(exist_ok=True)
    if args.import_generated:
        for name, source in json.loads(args.import_generated.read_text(encoding='utf-8')).items():
            if name not in SPECS:
                raise ValueError(name)
            clean_alpha(Image.open(source)).save(ROOT/'_source'/f'{name}.png')
    images = {}
    for name, (size, *_) in SPECS.items():
        source_path = ROOT/'_source'/f'{name}.png'
        source = clean_alpha(Image.open(source_path))
        source.save(source_path)
        if name == 'btn_square_normal':
            im = make_button(source)
        elif name == 'cursor_default':
            im = make_cursor(source)
        else:
            if name == 'glyph_pause':
                alpha = source.getchannel('A')
                source = ImageEnhance.Brightness(source).enhance(0.75)
                source.putalpha(alpha)
            im = outlined_asset(source, size)
        im.save(ROOT/f'{name}.png')
        images[name] = im
    make_board(images)
    manifest(json.loads((ROOT/'_tools'/'prompts.json').read_text(encoding='utf-8')))
    print('Stage 0: 6 assets + sources + style board + group sheets + manifest.')


if __name__ == '__main__':
    main()
