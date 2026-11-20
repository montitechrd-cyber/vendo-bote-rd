"""Genera public/assets/img/og-default.jpg (1200x630) con el logo, los stickers y el estilo del hero."""
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
S=2; W,H=1200*S,630*S
img='public/assets/img/'
def font(n,sz): return ImageFont.truetype('C:/Windows/Fonts/'+n,sz*S)
# fondo: degradado del hero
bg=Image.new('RGB',(W,H)); px=bg.load()
stops=[(0,(255,255,255)),(.45,(241,249,254)),(.78,(215,241,252)),(1,(174,228,248))]
for y in range(H):
    t=y/(H-1)
    for i in range(len(stops)-1):
        if stops[i][0]<=t<=stops[i+1][0]:
            a,b=stops[i],stops[i+1]; u=(t-a[0])/(b[0]-a[0])
            c=tuple(round(a[1][k]+(b[1][k]-a[1][k])*u) for k in range(3)); break
    for x in range(W): px[x,y]=c
bg=bg.convert('RGBA')
# sol suave arriba a la derecha
sun=Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(sun).ellipse((W-620*S,-300*S,W+260*S,520*S),fill=(255,214,130,70))
bg=Image.alpha_composite(bg,sun.filter(ImageFilter.GaussianBlur(90*S)))
# olas
def wave(base,amp,per,ph,col):
    l=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(l)
    pts=[(x,base*S+amp*S*math.sin((x/S)/per*2*math.pi+ph)) for x in range(0,W+1,6)]
    d.polygon(pts+[(W,H),(0,H)],fill=col); return l
for args in [(520,14,210,0.5,(10,91,184,60)),(550,12,160,2.0,(43,181,230,120)),(580,10,130,4.0,(10,91,184,200)),(604,7,110,1.0,(10,61,133,255))]:
    bg=Image.alpha_composite(bg,wave(*args))
d=ImageDraw.Draw(bg)
# logo
logo=Image.open(img+'logo-hd.webp').convert('RGBA'); lg=210*S; logo=logo.resize((lg,lg),Image.LANCZOS)
glow=Image.new('RGBA',(W,H),(0,0,0,0)); ImageDraw.Draw(glow).ellipse((20*S,10*S,300*S,290*S),fill=(43,181,230,55))
bg=Image.alpha_composite(bg,glow.filter(ImageFilter.GaussianBlur(30*S)))
bg.alpha_composite(logo,(64*S,44*S))
# textos
d=ImageDraw.Draw(bg)
d.text((76*S,262*S),'Tu día en el mar',font=font('segoeuib.ttf',68),fill=(11,27,51))
d.text((76*S,338*S),'empieza aquí',font=font('segoeuib.ttf',68),fill=(10,91,184))
d.text((78*S,432*S),'Renta de botes, yates y lanchas',font=font('segoeui.ttf',27),fill=(90,107,130))
d.text((78*S,466*S),'en República Dominicana',font=font('segoeui.ttf',27),fill=(90,107,130))
# pastillas
x=78; f=font('segoeuib.ttf',20)
for t in ['Boca Chica','Punta Cana','La Romana']:
    w=d.textlength(t,font=f)/S+36
    d.rounded_rectangle((x*S,512*S,(x+w)*S,556*S),radius=22*S,fill=(255,255,255,235),outline=(10,91,184,60),width=2)
    d.text(((x+18)*S,522*S),t,font=f,fill=(10,91,184)); x+=w+10
# stickers (sombra + imagen)
def put(name,w,pos,ang):
    s=Image.open(img+name).convert('RGBA'); s=s.resize((w*S,round(s.height*w*S/s.width)),Image.LANCZOS)
    s=s.rotate(ang,resample=Image.BICUBIC,expand=True)
    sh=Image.new('RGBA',(W,H),(0,0,0,0)); a=s.split()[3].point(lambda v:int(v*.35))
    blk=Image.new('RGBA',s.size,(10,61,133,255)); blk.putalpha(a)
    sh.alpha_composite(blk,(pos[0]*S,pos[1]*S+22*S)); sh=sh.filter(ImageFilter.GaussianBlur(14*S))
    return sh,s
global_bg=bg
for name,w,pos,ang in [('sticker-flybridge.webp',560,(600,150),-2)]:
    sh,s=put(name,w,pos,ang); global_bg=Image.alpha_composite(global_bg,sh); global_bg.alpha_composite(s,(pos[0]*S,pos[1]*S))
d=ImageDraw.Draw(global_bg)
f=font('segoeuib.ttf',22); t='vendoboterd.com'
d.text((W-72*S-d.textlength(t,font=f),34*S),t,font=f,fill=(10,61,133))
out=global_bg.convert('RGB').resize((1200,630),Image.LANCZOS)
out.save(img+'og-default.jpg',quality=90,optimize=True,progressive=True); print('ok')
