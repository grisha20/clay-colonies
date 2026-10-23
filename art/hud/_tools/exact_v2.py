"""Reproducible target-derived HUD v2 art; no game code in this module."""
import io,json,math,sys
from pathlib import Path
import numpy as np
import cv2
from PIL import Image,ImageDraw,ImageFilter,ImageEnhance
from scipy.ndimage import distance_transform_edt,binary_fill_holes,label
from hud_v2 import clean_source,sprite,V2_REQUIRED,V2_STAGES

ROOT=Path(__file__).resolve().parents[1]
REF=ROOT.parents[1]/'docs/godot/reference/hud_target.png'
K=4
INK=(90,58,34)
CREAM=(255,244,224)
ORANGE=(252,180,69)
# Coordinates are native pixels of our generated 1672x941 reference.
CROPS={
'res_clay':(489,23,526,57),'res_special':(596,22,635,57),'res_food':(670,21,709,59),
'res_wood':(767,21,806,57),'res_stone':(858,21,900,59),'res_people':(949,22,986,59),
'job_clay':(1358,214,1399,248),'job_wood':(1357,254,1399,289),'job_stone':(1356,290,1399,328),
'job_build':(1354,329,1402,369),'job_guard':(1356,368,1399,408),'job_fish':(1356,408,1399,449),'job_hunt':(1357,448,1399,490),
'build_hut':(461,787,548,863),'build_house':(589,787,688,864),'build_storage':(719,791,823,863),
'build_workshop':(852,786,950,863),'build_kiln':(993,786,1077,865),'build_idol':(1135,784,1219,865),
'tab_settlement':(573,741,599,770),'tab_defense':(785,742,812,773),'tab_land':(979,740,1007,775),
'icon_works':(1358,91,1389,128),'icon_person':(1357,129,1383,154),'icon_kiln':(1358,496,1410,555),
'icon_mother':(1236,656,1260,680),
'time_day':(1054,15,1108,65),'weather_clear':(1054,15,1108,65),
'logo_hud':(12,7,234,80),
}
TITLES={
'logo_hud':'Логотип Clayfolk для HUD','ui_topbar':'Пилюля ресурсов','ui_toast':'Всплывающее уведомление',
'ui_toast_check':'Успешное уведомление','ui_toast_warn':'Предупреждение','ui_toast_danger':'Опасность',
'ui_checkbox_on':'Выполненная цель','ui_checkbox_off':'Невыполненная цель',
'glyph_chevron_down':'Свернуть панель','glyph_chevron_right':'Развернуть панель',
'ui_tabbar':'Подложка вкладок построек','ui_tab_underline':'Подчёркивание активной вкладки',
'tab_settlement':'Вкладка «Поселение»','tab_defense':'Вкладка «Оборона»','tab_land':'Вкладка «Земля»',
'ui_key_badge_normal':'Плашка клавиши','ui_key_badge_active':'Плашка выбранной клавиши',
'ui_segment_left_normal':'Левая половина переключателя','ui_segment_left_active':'Активная левая половина переключателя',
'ui_segment_right_normal':'Правая половина переключателя','ui_segment_right_active':'Активная правая половина переключателя',
'ui_list_bg':'Подложка списка работ','icon_works':'Значок работ','icon_person':'Силуэт жителя',
'icon_kiln':'Печь для полосы обжига','icon_mother':'Головка Праматери',
**{'btn_pin_'+s:'Метка места — '+r for s,r in [('normal','обычная'),('hover','наведение'),('pressed','нажатая')]},
**{'btn_zoom_'+s:'Кнопка масштаба — '+r for s,r in [('normal','обычная'),('hover','наведение'),('pressed','нажатая')]},
}


def reference_cut(name):
    ref=Image.open(REF).convert('RGB')
    box=CROPS[name]
    sx,sy=ref.width/1672,ref.height/941
    box=tuple(round(v*(sx if i%2==0 else sy)) for i,v in enumerate(box))
    a=np.asarray(ref.crop(box)).astype(float)
    h,w=a.shape[:2]
    corners=np.concatenate([a[:2,:2].reshape(-1,3),a[:2,-2:].reshape(-1,3),a[-2:,:2].reshape(-1,3),a[-2:,-2:].reshape(-1,3)])
    bg=np.median(corners,axis=0)
    diff=np.max(np.abs(a-bg),axis=2)
    gc=np.where(diff>20,cv2.GC_PR_FGD,cv2.GC_PR_BGD).astype('uint8')
    gc[diff<9]=cv2.GC_BGD
    gc[diff>max(42,float(np.percentile(diff,70)))]=cv2.GC_FGD
    gc[0]=0;gc[-1]=0;gc[:,0]=0;gc[:,-1]=0
    cv2.setRNGSeed(0)
    cv2.grabCut(a.astype('uint8'),gc,None,np.zeros((1,65)),np.zeros((1,65)),5,cv2.GC_INIT_WITH_MASK)
    binary=(gc==cv2.GC_FGD)|(gc==cv2.GC_PR_FGD)
    if name in ('time_day','weather_clear'):
        # The pill's outer edge crosses this crop; it is not part of the sun.
        bg=np.array((251,240,216),float)
        binary=(a[:,:,0]>a[:,:,1]*1.12)&(a[:,:,1]>a[:,:,2]*1.3)&(a[:,:,0]>150)
    if name in ('build_hut','build_house','build_kiln','build_idol'):
        binary=binary_fill_holes(cv2.morphologyEx(binary.astype('uint8'),cv2.MORPH_CLOSE,np.ones((3,3),'uint8')).astype(bool))
    if name.startswith('build_'):
        components,n=label(binary)
        for component in range(1,n+1):
            yy,xx=np.where(components==component)
            if len(xx) and xx.max()<28 and yy.max()<35:
                binary[components==component]=False
    core=cv2.erode(binary.astype('uint8'),np.ones((3,3),'uint8')).astype(bool)
    if not core.any():core=binary
    nearest=distance_transform_edt(~core,return_distances=False,return_indices=True)
    fg=a[nearest[0],nearest[1]]
    delta=fg-bg[None,None,:]
    alpha=np.clip(np.sum((a-bg)*delta,axis=2)/np.maximum(1,np.sum(delta*delta,axis=2)),0,1)
    outer=cv2.dilate(binary.astype('uint8'),np.ones((3,3),'uint8')).astype(bool)
    alpha[~outer]=0;alpha[core]=1
    alpha[:1]=0;alpha[-1:]=0;alpha[:,:1]=0;alpha[:,-1:]=0
    parts,n=label(alpha>.18)
    sizes=np.bincount(parts.ravel());keep=np.flatnonzero(sizes>=max(3,h*w*.002))
    keep=keep[keep!=0]
    alpha[~np.isin(parts,keep)]=0
    # Small near-cream highlights belong to clay/roof surfaces, not pinholes.
    holes=binary_fill_holes(alpha>.5)&(alpha<=.5)
    hp,hn=label(holes);hs=np.bincount(hp.ravel())
    for p in range(1,hn+1):
        if hs[p]<=10:alpha[hp==p]=1
    out=np.zeros((h,w,4),dtype='uint8')
    # Remove the cream matte from antialiased silhouette pixels.
    rgb=np.where(core[:,:,None],a,fg)
    out[:,:,:3]=rgb.astype('uint8');out[:,:,3]=np.rint(alpha*255).astype('uint8')
    if name=='logo_hud':
        # Exclude the grass baseline below the lettering; keep the leaf crown.
        yy,xx=np.indices((h,w))
        grass=(a[:,:,1]>a[:,:,0]*1.03)&(a[:,:,1]>a[:,:,2]*1.3)
        out[(xx>65)&(yy>57)&grass]=0
    out[out[:,:,3]<3]=0
    im=Image.fromarray(out)
    return im.resize((w*4,h*4),Image.Resampling.LANCZOS)


def cfg(name,old):
    s=dict(old)
    for key in ('base','parts','fill','palette','brightness','ink_details','v2_flip','v2_fill_bottom'):
        s.pop(key,None)
    s.update(style_version=2,v2_stage=V2_REQUIRED.get(name,1),mode='v2',source_max=1024,v2_exact=True,v2_margin=4)
    s.setdefault('title',name.replace('_',' '));s.setdefault('where','HUD v2 · '+name)
    if name in TITLES:s['title']=TITLES[name]
    if name.endswith('_light') and name.removesuffix('_light') in TITLES:s['title']=TITLES[name.removesuffix('_light')]+' — светлый'
    s.setdefault('group',name.split('_')[0]);s.setdefault('stage',8)
    s['v2_kind']='sprite'
    if name in CROPS:
        s['v2_ref']=list(CROPS[name])
        s['prompt']='Derived from our generated docs/godot/reference/hud_target.png, native crop '+str(CROPS[name])+': target-faithful foreground extraction, cream matte removal, alpha cleanup; no new scene/text. Original generation: Clayfolk HUD redesign in this chat.'
    elif s.get('prompt') is None:s['prompt']='Derived from our generated Clayfolk HUD target; exact_v2.py recipe '+name
    if name.startswith(('time_','weather_')):s['size']=[64,64]
    if name.startswith('btn_square_'):s.update(size=[96,96],v2_kind='button',v2_shape='bevel',slice=[20,20,20,20])
    elif name.startswith('card_build_'):s.update(size=[128,144],v2_kind='card',v2_shape='rounded',slice=[22,22,22,22])
    elif name in ('ui_panel','ui_panel_dark','ui_list_bg'):s.update(size=[128,128],v2_kind='panel',v2_shape='rounded',slice=[24,24,24,24])
    elif name=='ui_tooltip':s.update(size=[128,96],v2_kind='panel',v2_shape='rounded',slice=[24,24,24,24])
    elif name.startswith('ui_button_wide_'):s.update(size=[192,48],v2_kind='button',v2_shape='rounded',slice=[16,16,16,16])
    elif name.startswith(('ui_btn_plus_','ui_btn_minus_')):s.update(size=[32,32],v2_kind='button',v2_shape='bevel',slice=[10,10,10,10])
    elif name.startswith('ui_bar_'):s.update(size=[128,18],v2_kind='bar',v2_shape='bar',slice=[8,5,8,5])
    elif name=='mother_bubble':s.update(size=[320,128],v2_kind='panel',v2_shape='bubble',slice=[24,24,72,40])
    elif name=='minimap_frame':s.update(size=[256,256],v2_kind='frame',v2_shape='frame',slice=[24,24,24,24],v2_center='transparent')
    elif name=='ui_topbar':s.update(size=[256,72],v2_kind='panel',v2_shape='rounded',slice=[36,28,36,28])
    elif name=='ui_toast':s.update(size=[256,56],v2_kind='panel',v2_shape='rounded',slice=[20,20,20,20])
    elif name=='ui_tabbar':s.update(size=[256,64],v2_kind='panel',v2_shape='tabbar',slice=[28,24,28,12])
    elif name=='ui_tab_underline':s.update(size=[128,8],v2_kind='line',v2_shape='underline',slice=[10,2,10,2],v2_center='mixed')
    elif name.startswith('ui_segment_'):s.update(size=[128,48],v2_kind='button',v2_shape='segment',slice=[16,14,16,14])
    elif name.startswith('ui_key_badge_'):s.update(size=[32,32],v2_kind='button',v2_shape='rounded',slice=[10,10,10,10])
    elif name.startswith('btn_zoom_'):s.update(size=[40,40],v2_kind='button',v2_shape='bevel',slice=[12,12,12,12])
    elif name.startswith('btn_pin_'):s.update(size=[48,48],v2_shape='pin')
    elif name.startswith('glyph_chevron_'):s.update(size=[32,32],v2_shape='glyph')
    elif name.startswith('glyph_'):s.update(size=[48,48],v2_shape='glyph')
    elif name=='logo_hud':s.update(size=[512,144],v2_margin=4)
    elif name in ('ui_checkbox_on','ui_checkbox_off','ui_check','icon_person','icon_mother'):s.setdefault('size',[32,32])
    elif name in ('ui_toast_check','ui_toast_warn','ui_toast_danger','icon_works','tab_settlement','tab_defense','tab_land'):s.setdefault('size',[48,48])
    elif name=='icon_kiln':s['size']=[64,64]
    if name.startswith(('res_','build_')):s['v2_margin']=5
    if name in ('res_wood','job_build'):s.pop('v2_flip',None)
    s['v2_fill_top']=[255,244,224]
    s['v2_border']=[207,168,119]
    s['v2_recipe']=name
    state=name.rsplit('_',1)[-1]
    if state in ('normal','hover','pressed','disabled','active'):s['state']=state
    if s.get('v2_shape'):s['prompt']='Derived from our generated HUD target; exact_v2.py '+s['v2_shape']+' recipe '+name+'. Volumetric rim, clean stretchable centre, alpha shadow; no text except logo.'
    return s


def rgba_finish(im,size):
    im=im.resize(size,Image.Resampling.LANCZOS)
    data=np.array(im)
    data[data[:,:,3]<2]=0
    return Image.fromarray(data)


def shaped(size,name,shape):
    w,h=size;W,H=w*K,h*K
    mask=Image.new('L',(W,H));d=ImageDraw.Draw(mask)
    active=name.endswith(('_pressed','_active'))
    disabled=name.endswith('_disabled')
    tiny=min(size)<=48
    pad=2 if tiny else 4
    box=(pad*K,pad*K,(w-pad)*K-1,(h-pad-3)*K-1)
    radius=min(16 if not tiny else 8,(h-2*pad-3)/2)
    if name=='ui_topbar':radius=26
    if shape=='bevel':radius=18 if w==96 else min(10,(h-2*pad-3)/2)
    if shape=='bar':pad=1;box=(K,K,(w-1)*K-1,(h-1)*K-1);radius=7
    d.rounded_rectangle(box,radius=radius*K,fill=255)
    if shape=='segment':
        if '_left_' in name:d.rectangle((W//2,box[1],box[2],box[3]),fill=255)
        else:d.rectangle((box[0],box[1],W//2,box[3]),fill=255)
    if shape=='tabbar':d.rectangle((box[0],H//2,box[2],box[3]),fill=255)
    if shape=='bubble':
        mask=Image.new('L',(W,H));d=ImageDraw.Draw(mask)
        d.rounded_rectangle((4*K,4*K,(w-4)*K,(h-20)*K),radius=14*K,fill=255)
        d.polygon([((w-55)*K,(h-23)*K),((w-24)*K,(h-7)*K),((w-29)*K,(h-27)*K)],fill=255)
    distance=distance_transform_edt(np.array(mask)>0)/K
    inside=distance>0
    top=np.array((255,248,234),float);bottom=np.array((250,234,207),float)
    if active:top=np.array((255,200,117),float);bottom=np.array((255,216,153),float)
    if name.startswith('ui_segment_') and active:top=np.array((216,126,66),float);bottom=np.array((188,88,43),float)
    if shape=='bevel' and active:top=np.array((255,187,72),float);bottom=np.array((248,164,47),float)
    if disabled:top=np.array((229,224,211),float);bottom=np.array((216,207,190),float)
    if name=='ui_list_bg':top=np.array((255,248,234),float);bottom=np.array((255,242,219),float)
    if name.endswith('_hover'):
        top+=(255-top)*.35;bottom+=(255-bottom)*.20
    if name=='ui_toast':top=np.array((107,158,71),float);bottom=np.array((69,116,40),float)
    if shape=='bar':
        top=np.array((237,214,180),float);bottom=np.array((230,200,158),float)
        if 'amber' in name:top=np.array((255,195,61),float);bottom=np.array((245,149,25),float)
        elif 'green' in name:top=np.array((139,188,80),float);bottom=np.array((83,142,49),float)
    yy=np.clip(np.arange(H)/(H-1),0,1)
    rgb=np.broadcast_to(top[None,None,:]*(1-yy[:,None,None])+bottom[None,None,:]*yy[:,None,None],(H,W,3)).copy()
    border=np.array((200,158,110) if not active else (220,131,28),float)
    if shape=='bar':border=np.array((193,156,112),float)
    edge=2.7 if name=='card_build_pressed' else (1.4 if not tiny else .9)
    if shape=='bevel':
        # Smooth, substantial raised rim and a shaded recessed well.
        rim=6 if w==96 else 3
        profile=np.clip(distance/rim,0,1)
        light=(1-np.indices((H,W))[0]/H)*.7+(1-np.indices((H,W))[1]/W)*.3
        rim_rgb=np.array((255,244,218) if not active else (255,211,104),float)
        outer=np.array((188,149,105) if not active else (209,129,24),float)
        rim_value=np.clip(light*.22+.84,0,1.1)
        rim_color=rim_rgb[None,None,:]*rim_value[:,:,None]
        dip=np.exp(-((distance-rim)/1.1)**2)*.13
        dip[distance>=rim+2]=0
        rgb=np.where((distance<=rim)[:,:,None],rim_color,rgb*(1-dip[:,:,None]))
        rgb[distance<.85]=outer
    else:rgb[(distance>0)&(distance<edge)]=border
    if shape=='frame':
        # Light wooden rim; fully transparent map centre.
        rgb[:]=np.array((183,133,79))
        rgb[(distance>1)&(distance<4)]=(240,199,138)
        inside &= distance<7
    alpha=np.where(inside,255,0).astype('uint8')
    shadow=mask.filter(ImageFilter.GaussianBlur((1.4 if tiny else 2)*K))
    moved=Image.new('L',(W,H));moved.paste(shadow,(0,2*K))
    out=Image.new('RGBA',(W,H),(70,40,15,0));out.putalpha(moved.point(lambda a:round(a*.24)))
    if shape=='frame':
        # Never shade or tint the minimap's transparent centre.
        sh=np.array(out);sh[distance>=7]=0;out=Image.fromarray(sh)
    if shape=='bar':out=Image.new('RGBA',(W,H))
    pix=np.zeros((H,W,4),dtype='uint8');pix[:,:,:3]=np.clip(rgb,0,255).astype('uint8');pix[:,:,3]=alpha
    out.alpha_composite(Image.fromarray(pix))
    # A narrow convex highlight follows the upper inner rim.
    hi=Image.new('RGBA',(W,H));hd=ImageDraw.Draw(hi)
    if shape not in ('frame','bar'):
        hi_box=(box[0]+K,box[1]+K,box[2]-K,box[3]-K)
        hd.rounded_rectangle(hi_box,radius=max(1,radius-1)*K,outline=(255,255,246,180),width=K)
        hd.rectangle((0,box[1]+4*K,W,H),fill=(0,0,0,0));out.alpha_composite(hi)
    return rgba_finish(out,size)


def symbol(size,name):
    w,h=size;W,H=w*K,h*K
    im=Image.new('RGBA',(W,H));d=ImageDraw.Draw(im)
    ink=INK+(255,);paper=(255,250,236,255)
    def line(points,color=ink,width=4):d.line([(round(x*K),round(y*K)) for x,y in points],fill=color,width=round(width*K),joint='curve')
    def poly(points,color=ink):d.polygon([(round(x*K),round(y*K)) for x,y in points],fill=color)
    def rr(box,color,r=3):d.rounded_rectangle(tuple(round(v*K) for v in box),radius=r*K,fill=color)
    if name.startswith('glyph_'):
        n=name.removeprefix('glyph_').removesuffix('_light');ink=(242,227,189,255) if name.endswith('_light') else ink
        if n=='pause':rr((12,7,20,41),ink);rr((28,7,36,41),ink)
        elif n in ('play','fast','faster'):
            count={'play':1,'fast':2,'faster':3}[n];span=34/count
            for i in range(count):
                x=7+i*span;poly([(x,8),(x,40),(x+span-3,24)],ink)
        elif n=='plus':rr((20,7,28,41),ink,2);rr((7,20,41,28),ink,2)
        elif n=='minus':rr((7,20,41,28),ink,2)
        elif n.startswith('chevron'):
            line([(9,12),(16,20),(23,12)] if n.endswith('down') else [(12,9),(20,16),(12,23)],ink,4)
        elif n=='settings':
            pts=[]
            for i in range(48):
                a=i*math.tau/48;rad=18 if i%6 in (1,2,3) else 14
                pts.append((24+rad*math.cos(a),24+rad*math.sin(a)))
            poly(pts,ink);d.ellipse((19*K,19*K,29*K,29*K),fill=(0,0,0,0))
        elif n in ('alarm','alarm_on'):
            d.ellipse((21*K,6*K,27*K,12*K),fill=ink)
            poly([(24,9),(15,14),(14,28),(10,33),(38,33),(34,28),(33,14)],ink)
            d.ellipse((21*K,33*K,27*K,39*K),fill=ink)
            if n.endswith('_on'):
                d.arc((7*K,10*K,21*K,36*K),120,240,fill=ink,width=2*K)
                d.arc((27*K,10*K,41*K,36*K),300,420,fill=ink,width=2*K)
    elif name in ('ui_check','ui_checkbox_on','ui_checkbox_off') or name.startswith('ui_toast_'):
        if name.startswith('ui_toast_'):
            col=(90,143,55,255) if name.endswith('check') else ((225,139,42,255) if name.endswith('warn') else (198,64,47,255))
            d.ellipse((4*K,4*K,(w-4)*K,(h-4)*K),fill=col)
            if name.endswith('check'):line([(12,24),(21,32),(36,16)],paper,4)
            else:rr((22,12,26,29),paper,2);d.ellipse((22*K,33*K,26*K,37*K),fill=paper)
        elif name=='ui_check':line([(6,16),(13,23),(26,8)],(83,135,49,255),4)
        else:
            rr((3,3,29,29),(84,133,49,255) if name.endswith('on') else (241,225,199,255),6)
            if name.endswith('on'):line([(8,15),(14,22),(25,9)],paper,3)
    elif name.startswith('btn_pin_'):
        pin_color=(225,120,59,255) if name.endswith('hover') else ((185,79,31,255) if name.endswith('pressed') else (207,101,44,255))
        d.ellipse((4*K,4*K,44*K,44*K),fill=pin_color,outline=(242,197,142,255),width=2*K)
        d.ellipse((17*K,12*K,31*K,26*K),fill=paper);poly([(17,21),(24,35),(31,21)],paper)
        d.ellipse((21*K,16*K,27*K,22*K),fill=(207,101,44,255))
    elif name=='ui_tab_underline':rr((4,3,124,6),(190,88,28,255),2)
    elif name in ('time_dawn','time_dusk'):
        col=(245,172,64,255) if name.endswith('dawn') else (221,111,46,255)
        d.ellipse((16*K,19*K,48*K,51*K),fill=col)
        for angle in range(180,361,45):
            t=math.radians(angle)
            line([(32+21*math.cos(t),35+21*math.sin(t)),(32+26*math.cos(t),35+26*math.sin(t))],col,3)
        d.rectangle((0,45*K,W,H),fill=(0,0,0,0))
        line([(9,45),(55,45)],(162,114,67,255),3)
    else:raise ValueError('Unknown v2 symbol '+name)
    result=rgba_finish(im,size)
    if name.endswith('_light'):
        data=np.array(result);data[data[:,:,3]>0,:3]=(242,227,189);data[data[:,:,3]==0]=0
        result=Image.fromarray(data)
    if name!='ui_tab_underline':
        data=np.array(result);data[:4]=0;data[-4:]=0;data[:,:4]=0;data[:,-4:]=0
        rgb=data[:,:,:3]
        white=(data[:,:,3]>0)&(data[:,:,3]<255)&(rgb.min(axis=2)>235)&(rgb.max(axis=2)-rgb.min(axis=2)<20)
        data[white,:3]=np.minimum(data[white,:3],233)
        result=Image.fromarray(data)
    return result


def soften_legacy(source):
    # Work from a generated original, removing only its old painted ink fringe.
    data=np.array(source.convert('RGBA'));mask=data[:,:,3]>=128
    dist=distance_transform_edt(mask)
    dark=(data[:,:,0]<125)&(data[:,:,1]<95)&(data[:,:,2]<72)
    edge=(dark&(dist<max(2,min(source.size)*.026)))|np.all(data[:,:,:3]==(77,51,31),axis=2)&mask
    good=mask&~edge
    near=distance_transform_edt(~good,return_distances=False,return_indices=True)
    data[edge,:3]=data[near[0][edge],near[1][edge],:3]
    data[~mask]=0
    return Image.fromarray(data)


def render(source,size,spec):
    name=spec['v2_recipe'];shape=spec.get('v2_shape')
    if shape in ('bevel','rounded','bar','bubble','frame','segment','tabbar'):return shaped(size,name,shape)
    if shape in ('glyph','pin','underline') or name.startswith(('ui_toast_','ui_checkbox_')) or name in ('ui_check','time_dawn','time_dusk'):return symbol(size,name)
    result=sprite(source,size,spec.get('v2_margin',4))
    data=np.array(result);rgb=data[:,:,:3]
    white=(data[:,:,3]>0)&(data[:,:,3]<255)&(rgb.min(axis=2)>235)&(rgb.max(axis=2)-rgb.min(axis=2)<20)
    data[white,:3]=np.minimum(data[white,:3],233)
    data[:4]=0;data[-4:]=0;data[:,:4]=0;data[:,-4:]=0
    return Image.fromarray(data)
