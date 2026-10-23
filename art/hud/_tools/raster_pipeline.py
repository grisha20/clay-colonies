"""Shared crisp raster finishing; Pillow + NumPy + SciPy, all offline.

Binary silhouettes and Euclidean stroke distances produce opaque #4D331F ink.
Only the final one-pixel coverage boundary is antialiased. No glow or blur.
"""
import numpy as np
from scipy.ndimage import distance_transform_edt
from PIL import Image, ImageDraw

INK = (77, 51, 31)
PAPER = (242, 227, 189)
SCALE = 4


def finish(image, size):
    image = image.resize(size, Image.Resampling.BOX)
    data = np.array(image)
    partial = (data[:,:,3] > 0) & (data[:,:,3] < 255)
    distance=distance_transform_edt(data[:,:,3]<255)
    data[partial & (distance>1.5),3]=0
    partial = (data[:,:,3] > 0) & (data[:,:,3] < 255)
    data[partial, :3] = INK
    data[data[:,:,3] == 0] = (0,0,0,0)
    return Image.fromarray(data)


def texture_mask(source):
    source = source.convert('RGBA')
    source.putalpha(source.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
    bbox = source.getchannel('A').getbbox()
    if bbox is None:
        raise ValueError('Empty source silhouette')
    return source.crop(bbox)


def paint_contour(texture, mask, outer, inner, fill=None):
    outside_distance = distance_transform_edt(~mask)
    outer_mask = outside_distance <= outer
    inner_mask = distance_transform_edt(mask) > inner
    result = np.zeros((*mask.shape, 4), dtype=np.uint8)
    result[outer_mask] = (*INK,255)
    rgb = np.array(texture.convert('RGB'))
    result[inner_mask,:3] = fill if fill is not None else rgb[inner_mask]
    result[inner_mask,3] = 255
    return Image.fromarray(result)


def icon(source, size, fill=None, margin=None, outer=None, inner=None):
    w,h = size
    margin = max(4,round(min(w,h)*.08)) if margin is None else margin
    outer = max(1,w*.03125) if outer is None else outer
    inner = max(.75,w*.015625) if inner is None else inner
    large = (w*SCALE,h*SCALE)
    cut = texture_mask(source)
    target=(round((w-2*margin-2*outer)*SCALE),round((h-2*margin-2*outer)*SCALE))
    ratio=min(target[0]/cut.width,target[1]/cut.height)
    cut=cut.resize((max(1,round(cut.width*ratio)),max(1,round(cut.height*ratio))),Image.Resampling.LANCZOS)
    cut.putalpha(cut.getchannel('A').point(lambda a: 255 if a >=128 else 0))
    texture = Image.new('RGBA',large)
    texture.paste(cut,((large[0]-cut.width)//2,(large[1]-cut.height)//2))
    mask = np.array(texture.getchannel('A')) >=128
    return finish(paint_contour(texture,mask,outer*SCALE,inner*SCALE,fill),size)


def cursor(source):
    # Broad conventional pointer silhouette. Both edges leave the tip immediately:
    # there is no separate narrow extension and no pasted-on needle.
    large=(64*SCALE,64*SCALE)
    shape=Image.new('L',large)
    vertices=[(4,4),(51,31),(35,35),(49,53),(39,59),(25,42),(17,53)]
    ImageDraw.Draw(shape).polygon([(x*SCALE,y*SCALE) for x,y in vertices],fill=255)
    cut=texture_mask(source)
    rgb=np.array(cut.convert('RGB'))
    opaque=np.array(cut.getchannel('A'))>=128
    # Extend the generated clay colour into the few reshaped edge pixels.
    nearest=distance_transform_edt(~opaque,return_distances=False,return_indices=True)
    rgb[~opaque]=rgb[tuple(axis[~opaque] for axis in nearest)]
    texture=Image.fromarray(rgb).resize((48*SCALE,56*SCALE),Image.Resampling.LANCZOS)
    canvas=Image.new('RGB',large,INK)
    canvas.paste(texture,(4*SCALE,4*SCALE))
    result=paint_contour(canvas,np.array(shape)>0,0,2.5*SCALE)
    result=finish(result,(64,64))
    # Coverage rounding must never move the hotspot off the actual tip.
    result.putpixel((4,4),(*INK,255))
    return result


def panel(source,size,inset):
    # Square source panels get stretched by sections, preserving corner shapes.
    cut=texture_mask(source)
    wide=cut.width/cut.height>3
    base_size=size if wide else (64,64)
    result=icon(source,base_size,margin=2,outer=1.25,inner=.5)
    if not wide and size!=(64,64):
        src=result
        result=Image.new('RGBA',size)
        sx=sy=[0,16,48,64]
        dx=[0,inset[0],size[0]-inset[2],size[0]]
        dy=[0,inset[1],size[1]-inset[3],size[1]]
        for y in range(3):
            for x in range(3):
                part=src.crop((sx[x],sy[y],sx[x+1],sy[y+1]))
                part=part.resize((dx[x+1]-dx[x],dy[y+1]-dy[y]),Image.Resampling.NEAREST)
                result.paste(part,(dx[x],dy[y]))
    l,t,r,b=inset
    w,h=size
    # Use constant edge sections and a uniform center for Godot 9-slice.
    copy=result.copy()
    for y in range(t,h-b):
        for x in range(w):
            result.putpixel((x,y),copy.getpixel((x,h//2)))
    copy=result.copy()
    for x in range(l,w-r):
        for y in range(h):
            result.putpixel((x,y),copy.getpixel((w//2,y)))
    ImageDraw.Draw(result).rectangle((l,t,w-r-1,h-b-1),fill=(*PAPER,255))
    return finish(result,size)
