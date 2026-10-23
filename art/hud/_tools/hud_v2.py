"""HUD v2 finishing: generated clay sprites and normalized stretchable surfaces.

The generated panel studies are normalized to the target's exact palette and
rounded geometry. Shadows stay inside the texture; no v1 ink contour is added.
"""
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
from scipy.ndimage import label

SAMPLES=('ui_panel','btn_square_normal','btn_square_pressed','res_wood',
         'job_build','card_build_pressed')
V2_STAGES={
    1:('ui_panel ui_tooltip mother_bubble minimap_frame ui_bar_bg ui_bar_fill_amber ui_bar_fill_green '
       'glyph_pause glyph_play glyph_fast glyph_faster glyph_settings glyph_plus glyph_minus glyph_alarm glyph_alarm_on').split()
      +[f'{family}_{state}' for family in ('btn_square','ui_button_wide','ui_btn_plus','ui_btn_minus','card_build')
        for state in ('normal','hover','pressed','disabled')],
    2:('res_clay res_special res_stone res_people res_food res_wood '
       'job_clay job_stone job_guard job_wood job_build job_fish job_hunt '
       'time_day time_dusk time_night time_dawn weather_clear weather_clouds weather_rain ui_check').split(),
    3:['build_'+n for n in 'hut house storage workshop kiln idol wall gate post totem harvest forbid erase campfire'.split()],
    4:('logo_hud ui_topbar ui_toast ui_toast_check ui_toast_warn ui_toast_danger ui_checkbox_on ui_checkbox_off '
       'glyph_chevron_down glyph_chevron_right ui_tabbar ui_tab_underline tab_settlement tab_defense tab_land '
       'ui_key_badge_normal ui_key_badge_active ui_segment_left_normal ui_segment_left_active '
       'ui_segment_right_normal ui_segment_right_active ui_list_bg icon_works icon_person icon_kiln icon_mother '
       'btn_pin_normal btn_pin_hover btn_pin_pressed btn_zoom_normal btn_zoom_hover btn_zoom_pressed').split(),
}
V2_REQUIRED={n:stage for stage,names in V2_STAGES.items() for n in names}
V2_REQUIRED.update({n:0 for n in SAMPLES})
K=4
SHADOW=(70,40,15)


def clean_source(image,preserve_cream=True):
    image=image.convert('RGBA')
    image.thumbnail((1024,1024),Image.Resampling.LANCZOS)
    data=np.array(image)
    alpha=data[:,:,3]
    alpha[alpha<3]=0
    alpha[alpha>=250]=255
    if not preserve_cream:
        rgb=data[:,:,:3]
        white=(alpha>0)&(alpha<255)&(rgb.min(axis=2)>235)&(rgb.max(axis=2)-rgb.min(axis=2)<20)
        alpha[white]=0
    # Remove isolated generator specks, preserving all substantial components.
    parts,count=label(alpha>0)
    if count:
        sizes=np.bincount(parts.ravel())
        bad=np.flatnonzero(sizes<max(4,alpha.size*.00002))
        bad=bad[bad!=0]
        alpha[np.isin(parts,bad)]=0
    data[alpha==0]=0
    return Image.fromarray(data)


def sprite(source,size,margin):
    data=np.array(source.convert('RGBA'))
    body=Image.fromarray((data[:,:,3]>=128).astype('uint8')*255)
    bbox=body.getbbox()
    if bbox is None:
        raise ValueError('Empty v2 generated subject')
    x0,y0,x1,y1=bbox
    cut=source.crop((max(0,x0-1),max(0,y0-1),min(source.width,x1+1),min(source.height,y1+1)))
    ratio=min((size[0]-2*margin)/cut.width,(size[1]-2*margin)/cut.height)
    cut=cut.resize((round(cut.width*ratio),round(cut.height*ratio)),Image.Resampling.LANCZOS)
    canvas=Image.new('RGBA',size)
    canvas.alpha_composite(cut,((size[0]-cut.width)//2,(size[1]-cut.height)//2))
    data=np.array(canvas)
    data[data[:,:,3]<3]=0
    return Image.fromarray(data)


def surface(size,spec):
    w,h=size
    large=(w*K,h*K)
    button=spec['v2_kind']=='button'
    bounds=(8,4,56,52) if button else (8,6,w-8,h-14)
    radius=13 if button else (14 if spec['v2_kind']=='card' else 16)
    blur=2.3 if button else 3
    shift=4
    edge=1.15
    box=tuple(round(v*K) for v in bounds)
    shape=Image.new('L',large)
    ImageDraw.Draw(shape).rounded_rectangle(box,radius=radius*K,fill=255)
    offset=Image.new('L',large)
    offset.paste(shape,(0,shift*K))
    shadow=offset.filter(ImageFilter.GaussianBlur(blur*K))
    shadow=shadow.point(lambda a:round(a*.25))
    result=Image.new('RGBA',large,(*SHADOW,0))
    result.putalpha(shadow)
    top=np.array(spec['v2_fill_top'],float)
    bottom=np.array(spec.get('v2_fill_bottom',spec['v2_fill_top']),float)
    # Uniform horizontal rows avoid a visible seam when 9-slicing the gradient.
    yy=np.clip((np.arange(large[1])-box[1])/(box[3]-box[1]),0,1)
    rgb=np.rint(top[None,:]*(1-yy[:,None])+bottom[None,:]*yy[:,None]).astype('uint8')
    data=np.zeros((large[1],large[0],4),dtype='uint8')
    data[:,:,:3]=rgb[:,None,:]
    data[:,:,3]=np.array(shape)
    face=Image.fromarray(data)
    border=Image.new('RGBA',large)
    d=ImageDraw.Draw(border)
    d.rounded_rectangle(box,radius=radius*K,outline=tuple(spec['v2_border'])+(255,),width=round(edge*K))
    # Restrained top highlight, following the inner corner radius.
    inner=tuple(round(v+edge*K) if i<2 else round(v-edge*K) for i,v in enumerate(box))
    highlight=Image.new('RGBA',large)
    hd=ImageDraw.Draw(highlight)
    hd.rounded_rectangle(inner,radius=(radius-edge)*K,outline=(255,255,255,145),width=K)
    hd.rectangle((0,box[1]+5*K,large[0],large[1]),fill=(0,0,0,0))
    face.alpha_composite(border)
    face.alpha_composite(highlight)
    result.alpha_composite(face)
    result=result.resize(size,Image.Resampling.LANCZOS)
    data=np.array(result)
    # Clip sub-byte blur tails only; retain real soft brown shadow coverage.
    data[data[:,:,3]<2]=0
    return Image.fromarray(data)


def render(source,size,spec):
    if spec['v2_kind'] in ('panel','button','card'):
        return surface(size,spec)
    if spec.get('v2_flip'):
        source=source.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    return sprite(source,size,spec.get('v2_margin',max(4,round(min(size)*.08))))
