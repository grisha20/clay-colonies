"""Fair sharpness comparison: same display size, old Git PNG vs native redraw."""
import io,subprocess
from PIL import Image,ImageDraw
from build_stage0 import ROOT,font,paste_center
from build_hud import load_catalog,write_manifest

NAMES=['res_clay','res_food','res_wood','res_stone','job_build','job_fish','tab_defense','tab_land','build_hut','build_storage','build_kiln','build_idol']

def main():
    board=Image.new('RGBA',(1280,1600),'#EEE7D9');d=ImageDraw.Draw(board)
    d.text((20,16),'Чёткость · прежняя вырезка / новый крупный рисунок',font=font(25,True),fill='#5A3A22')
    d.text((20,55),'В каждой паре один размер: 160 px. Малые копии рядом: 32 px.',font=font(17),fill='#75543B')
    for i,name in enumerate(NAMES):
        x=(i%2)*640;y=96+(i//2)*248
        d.rounded_rectangle((x+8,y,x+632,y+238),radius=12,fill='#FCF7ED')
        d.text((x+20,y+9),name,font=font(20,True),fill='#5A3A22')
        old=Image.open(io.BytesIO(subprocess.check_output(['git','show','fc659ff:art/hud/'+name+'.png'],cwd=ROOT.parents[1]))).convert('RGBA')
        new=Image.open(ROOT/(name+'.png')).convert('RGBA')
        for j,source in enumerate((old,new)):
            xx=x+20+j*310
            d.rounded_rectangle((xx,y+43,xx+172,y+217),radius=7,fill='#2B2118')
            large=source.copy();large.thumbnail((160,160),Image.Resampling.LANCZOS)
            # Upscale the old output too: both occupy exactly the same box.
            ratio=min(160/source.width,160/source.height)
            large=source.resize((round(source.width*ratio),round(source.height*ratio)),Image.Resampling.LANCZOS)
            paste_center(board,large,(xx+6,y+49,160,160))
            small=source.copy();small.thumbnail((32,32),Image.Resampling.LANCZOS)
            paste_center(board,small,(xx+188,y+92,40,40))
            d.text((xx,y+219),'ДО' if j==0 else 'ПОСЛЕ',font=font(12,True),fill='#75543B')
    board.save(ROOT/'_preview/sharpness_compare.png')
    write_manifest(load_catalog())

if __name__=='__main__':main()
