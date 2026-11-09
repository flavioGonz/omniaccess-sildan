# Genera capturas sintéticas de cámara LPR (sin datos reales) para la demo.
import json, sys, os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
items = json.load(open(sys.argv[1])); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
def font(sz, bold=True):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
COL = {"Blanco":(225,225,228),"Negro":(30,30,34),"Gris":(120,124,130),"Plata":(175,178,184),"Rojo":(170,30,35),"Azul":(35,60,140),"Verde":(40,95,60),"Beige":(196,180,150)}
for it in items:
    random.seed(it["file"])
    W,H=1280,720
    im=Image.new("RGB",(W,H),(40,44,50)); d=ImageDraw.Draw(im)
    for y in range(H):  # cielo/asfalto
        t=y/H; c=int(70-40*t); d.line([(0,y),(W,y)],fill=(c,c+4,c+10))
    d.polygon([(0,H),(W,H),(W*0.62,H*0.38),(W*0.38,H*0.38)],fill=(52,54,58))
    for k in range(6): y0=H*0.42+k*60; d.rectangle([W/2-4,y0,W/2+4,y0+30],fill=(200,200,190))
    d.rectangle([W*0.08,H*0.30,W*0.22,H*0.52],fill=(90,80,70)); d.rectangle([W*0.06,H*0.27,W*0.24,H*0.31],fill=(70,62,55))  # garita
    d.rectangle([W*0.22,H*0.47,W*0.48,H*0.49],fill=(230,190,40))  # barrera
    c=COL.get(it["color"],(150,150,150)); x0,y0,x1,y1=W*0.30,H*0.36,W*0.70,H*0.92
    d.rounded_rectangle([x0,y0+60,x1,y1],radius=40,fill=c)
    d.rounded_rectangle([x0+60,y0,x1-60,y0+120],radius=30,fill=tuple(max(0,v-25) for v in c))
    d.rounded_rectangle([x0+80,y0+18,x1-80,y0+105],radius=18,fill=(40,55,70))  # parabrisas
    for lx in (x0+30,x1-130): d.rounded_rectangle([lx,y0+150,lx+100,y0+190],radius=12,fill=(250,240,200))
    pw,ph=300,74; px,py=W/2-pw/2,y1-150
    d.rectangle([px,py,px+pw,py+ph],fill=(250,250,250),outline=(20,20,20),width=4)
    d.rectangle([px,py,px+pw,py+16],fill=(30,70,170))
    t=it["plate"]; f=font(46); tw=d.textlength(t,font=f); d.text((W/2-tw/2,py+20),t,font=f,fill=(15,15,15))
    im=im.filter(ImageFilter.GaussianBlur(0.6)); d=ImageDraw.Draw(im)
    d.rectangle([0,0,W,44],fill=(0,0,0)); d.text((16,10),it["cam"],font=font(22),fill=(255,255,255))
    d.rectangle([px-6,py-6,px+pw+6,py+ph+6],outline=(0,255,120),width=3)
    im.save(os.path.join(out,it["file"]),quality=82)
print("ok",len(items))
