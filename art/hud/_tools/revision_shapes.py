"""Small shape overlays on generated raster subjects. No game integration."""
from PIL import Image,ImageDraw
import numpy as np
import raster_pipeline as raster

K=4
RED=(232,58,42)


def alarm_on(source):
    canvas=Image.new('RGBA',(48*K,48*K))
    horn=raster.icon(source,(33*K,33*K),margin=0,outer=0,inner=0)
    canvas.alpha_composite(horn,(4*K,11*K))
    mask=Image.new('L',canvas.size)
    d=ImageDraw.Draw(mask)
    # Two separated arcs curve away from the flared bell.
    d.arc((25*K,7*K,38*K,27*K),285,405,fill=255,width=4*K)
    d.arc((25*K,2*K,46*K,32*K),285,405,fill=255,width=4*K)
    texture=Image.new('RGB',canvas.size,(202,155,82))
    waves=raster.paint_contour(texture,np.array(mask)>0,.55*K,0)
    canvas.alpha_composite(waves)
    return canvas


def forbid_cursor(pointer):
    canvas=pointer.resize((64*K,64*K),Image.Resampling.NEAREST)
    paper=Image.new('RGBA',canvas.size)
    ImageDraw.Draw(paper).ellipse((27*K,27*K,58*K,58*K),fill=(*raster.PAPER,255))
    canvas.alpha_composite(paper)
    mask=Image.new('L',canvas.size)
    d=ImageDraw.Draw(mask)
    d.ellipse((27*K,27*K,58*K,58*K),outline=255,width=4*K)
    d.line((32*K,32*K,53*K,53*K),fill=255,width=4*K)
    texture=Image.new('RGB',canvas.size,RED)
    badge=raster.paint_contour(texture,np.array(mask)>0,.75*K,0)
    canvas.alpha_composite(badge)
    return canvas


def raid_alert(source):
    canvas=Image.new('RGBA',(64*K,64*K))
    spider=raster.icon(source,(50*K,52*K),margin=2*K,outer=0,inner=0)
    canvas.alpha_composite(spider,(3*K,8*K))
    mask=Image.new('L',canvas.size)
    d=ImageDraw.Draw(mask)
    d.rounded_rectangle((48*K,6*K,55*K,27*K),radius=2*K,fill=255)
    d.ellipse((48*K,32*K,55*K,39*K),fill=255)
    texture=Image.new('RGB',canvas.size,RED)
    mark=raster.paint_contour(texture,np.array(mask)>0,1*K,0)
    canvas.alpha_composite(mark)
    return canvas
