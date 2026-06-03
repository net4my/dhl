#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render FR24-inspired GeoPilot redesign mockups as phone-resolution PNGs."""
import math, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = 2                      # 2x for crispness
W, H = 390 * S, 844 * S
FONTDIR = "/usr/share/fonts/truetype/dejavu/"
def F(name, size):
    return ImageFont.truetype(FONTDIR + name, int(size * S))
REG  = lambda s: F("DejaVuSans.ttf", s)
BOLD = lambda s: F("DejaVuSans-Bold.ttf", s)
MONO = lambda s: F("DejaVuSansMono.ttf", s)

def hx(c):
    c = c.lstrip("#")
    if len(c) == 6: return (int(c[0:2],16), int(c[2:4],16), int(c[4:6],16), 255)
    return (int(c[0:2],16), int(c[2:4],16), int(c[4:6],16), int(c[6:8],16))

def lerp(a, b, t): return tuple(int(a[i] + (b[i]-a[i])*t) for i in range(len(a)))

def vgrad(w, h, top, bot):
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        col = lerp(top, bot, y/max(1,h-1))
        for x in range(w):
            px[x, y] = col[:3]
    return img

def rrect(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)

def text(d, xy, s, font, fill, anchor=None, spacing=4):
    d.text(xy, s, font=font, fill=fill, anchor=anchor, spacing=spacing)

# ---- plane marker -------------------------------------------------
PLANE = [(50,5),(57,42),(95,63),(95,72),(57,57),(55,82),(70,92),(70,98),
         (50,90),(30,98),(30,92),(45,82),(43,57),(5,72),(5,63),(43,42)]
def plane_img(size, color, ring=None):
    sup = 4
    big = size*sup
    im = Image.new("RGBA", (big, big), (0,0,0,0))
    dd = ImageDraw.Draw(im)
    pts = [(x/100*big, y/100*big) for (x,y) in PLANE]
    if ring:
        dd.polygon(pts, fill=color, outline=ring, width=max(2,sup))
    else:
        dd.polygon(pts, fill=color)
    im = im.resize((size, size), Image.LANCZOS)
    return im

def paste_plane(base, size, color, x, y, track, ring=None):
    im = plane_img(size, color, ring)
    im = im.rotate(-track, resample=Image.BICUBIC, expand=True)
    base.alpha_composite(im, (int(x-im.width/2), int(y-im.height/2)))

# ---- fake map background -----------------------------------------
def map_bg(theme, w, h):
    base = Image.new("RGBA", (w, h), theme["map"])
    d = ImageDraw.Draw(base, "RGBA")
    # land blobs
    import random; random.seed(7)
    for poly in theme["land_polys"]:
        d.polygon([(int(px*w), int(py*h)) for px,py in poly], fill=theme["land"])
    # water
    for poly in theme["water_polys"]:
        d.polygon([(int(px*w), int(py*h)) for px,py in poly], fill=theme["water"])
    # roads
    rd = theme["road"]
    roads = [[(0.05,0.2),(0.3,0.35),(0.55,0.3),(0.8,0.5),(1.0,0.45)],
             [(0.1,0.8),(0.35,0.6),(0.5,0.7),(0.7,0.55),(0.95,0.7)],
             [(0.4,0.0),(0.45,0.3),(0.6,0.55),(0.55,0.85),(0.62,1.0)],
             [(0.0,0.55),(0.25,0.5),(0.5,0.52),(0.78,0.42),(1.0,0.5)]]
    for r in roads:
        pts = [(int(px*w), int(py*h)) for px,py in r]
        if theme.get("road_case"):
            d.line(pts, fill=theme["road_case"], width=int(7*S), joint="curve")
        d.line(pts, fill=rd, width=int(3*S), joint="curve")
    # subtle labels
    if theme.get("map_label"):
        for (s,(px,py)) in [("Malisheve",(0.34,0.27)),("Rahovec",(0.18,0.55)),("Suhareke",(0.55,0.62))]:
            text(d, (int(px*w), int(py*h)), s, REG(8), theme["map_label"], anchor="mm")
    return base

# ---- status bar + tab bar ----------------------------------------
def status_bar(img, d, theme, y0=0):
    text(d, (16*S, 20*S), "09:07", BOLD(13), theme["sb_fg"], anchor="lm")
    # right icons
    x = W-16*S
    text(d, (x, 20*S), "93", BOLD(12), theme["sb_fg"], anchor="rm")
    rrect(d, (x-44*S, 13*S, x-20*S, 27*S), 4*S, outline=theme["sb_fg"], width=2)
    d.rectangle((x-42*S, 15*S, x-25*S, 25*S), fill=theme["accent"])
    # signal dots
    for i,bx in enumerate([60,55,50,45]):
        bh = (i+1)*3*S
        d.rectangle((x-bx*S, 24*S-bh, x-bx*S+3*S, 24*S), fill=theme["sb_fg"])

TABS = [("home","Start"),("map","Karte"),("nav","Ziel"),("pin","Tracking"),("sat","Sat"),("plane","Flug"),("more","Mehr")]
def draw_icon(d, kind, cx, cy, col, sz):
    s = sz*S; r = s/2
    if kind=="home":
        d.line([(cx-r,cy),(cx,cy-r),(cx+r,cy)], fill=col, width=2*S, joint="curve")
        d.rectangle((cx-r*0.7,cy,cx+r*0.7,cy+r*0.8), outline=col, width=2*S)
    elif kind=="map":
        d.polygon([(cx-r,cy-r*0.6),(cx-r*0.2,cy-r),(cx+r*0.3,cy-r*0.6),(cx+r,cy-r),
                   (cx+r,cy+r*0.8),(cx+r*0.3,cy+r),(cx-r*0.2,cy+r*0.6),(cx-r,cy+r)],
                  outline=col, width=2*S)
    elif kind=="nav":
        d.ellipse((cx-r*0.55,cy-r,cx+r*0.55,cy+r*0.1), outline=col, width=2*S)
        d.polygon([(cx,cy+r),(cx-r*0.45,cy-r*0.1),(cx+r*0.45,cy-r*0.1)], fill=col)
    elif kind=="plane":
        im = plane_img(int(s), col); d.bitmap((int(cx-s/2),int(cy-s/2)), im.convert("1"), fill=col) if False else None
        base = d._image if hasattr(d,'_image') else None
    elif kind=="pin":
        d.ellipse((cx-r*0.7,cy-r,cx+r*0.7,cy+r*0.4), outline=col, width=2*S)
        d.line([(cx-r*0.55,cy+r*0.1),(cx,cy+r),(cx+r*0.55,cy+r*0.1)], fill=col, width=2*S, joint="curve")
        d.ellipse((cx-r*0.25,cy-r*0.45,cx+r*0.25,cy+r*0.05), fill=col)
    elif kind=="sat":
        d.ellipse((cx-2*S,cy-2*S,cx+2*S,cy+2*S), fill=col)
        for rr in (r*0.55,r):
            d.arc((cx-rr,cy-rr,cx+rr,cy+rr), 200, 340, fill=col, width=2*S)
    elif kind=="more":
        for dx in (-r*0.55,0,r*0.55):
            d.ellipse((cx+dx-2*S,cy-2*S,cx+dx+2*S,cy+2*S), fill=col)

def tab_bar(img, d, theme, active="plane"):
    th = 70*S; y0 = H-th
    d.rectangle((0,y0,W,H), fill=theme["panel"])
    d.line((0,y0,W,y0), fill=theme["border"], width=1*S)
    n=len(TABS); cw=W/n
    for i,(k,lbl) in enumerate(TABS):
        cx=int(cw*i+cw/2); col=theme["accent"] if k==active else theme["muted"]
        if k=="plane":
            paste_plane(img, int(20*S), col, cx, y0+24*S, 0)
        else:
            draw_icon(d, k, cx, y0+24*S, col, 19)
        text(d, (cx, y0+50*S), lbl, BOLD(8.5), col, anchor="mm")
        if k==active:
            d.rounded_rectangle((cx-12*S,y0+2*S,cx+12*S,y0+5*S), radius=2*S, fill=theme["accent"])

def fab(img, d, theme, cx, cy, kind, on=False):
    r=22*S
    fill = theme["accent"] if on else theme["fab"]
    fg = (255,255,255,255) if on else theme["fab_fg"]
    d.ellipse((cx-r,cy-r,cx+r,cy+r), fill=fill, outline=theme["border"], width=1*S)
    s=20
    if kind=="layers":
        rr=10*S
        d.polygon([(cx,cy-rr*0.7),(cx+rr*0.8,cy-rr*0.2),(cx,cy+rr*0.3),(cx-rr*0.8,cy-rr*0.2)], outline=fg, width=2*S)
        d.line([(cx-rr*0.8,cy+rr*0.2),(cx,cy+rr*0.7),(cx+rr*0.8,cy+rr*0.2)], fill=fg, width=2*S, joint="curve")
    elif kind=="tag":
        d.polygon([(cx-9*S,cy-6*S),(cx+3*S,cy-6*S),(cx+9*S,cy),(cx+3*S,cy+6*S),(cx-9*S,cy+6*S)], outline=fg, width=2*S)
        d.ellipse((cx-6*S,cy-2*S,cx-2*S,cy+2*S), fill=fg)
    elif kind=="airport":
        paste_plane(img, int(18*S), fg, cx, cy, 35)
    elif kind=="auto":
        d.line([(cx-7*S,cy-7*S),(cx-7*S,cy+7*S)], fill=fg, width=2*S)
        d.polygon([(cx,cy-7*S),(cx+8*S,cy),(cx,cy+7*S)], fill=fg)
    elif kind=="refresh":
        d.arc((cx-9*S,cy-9*S,cx+9*S,cy+9*S), 60, 360, fill=fg, width=2*S)
        d.polygon([(cx+9*S,cy-9*S),(cx+9*S,cy-1*S),(cx+2*S,cy-6*S)], fill=fg)

# ====================================================================
def render(variant, theme):
    img = Image.new("RGBA", (W, H), theme["bg"])
    # ---- map fills the screen behind everything
    mp = map_bg(theme, W, H)
    img.alpha_composite(mp, (0, 0))
    d = ImageDraw.Draw(img, "RGBA")

    # ---- header bar
    hb = 92*S
    if theme.get("header_solid"):
        d.rectangle((0,0,W,hb), fill=theme["panel"])
        d.line((0,hb,W,hb), fill=theme["border"], width=1*S)
    status_bar(img, d, theme)
    # logo
    lg=(16*S,46*S,52*S,82*S)
    rrect(d, lg, 10*S, fill=None)
    logo=vgrad(36*S,36*S, hx("#2563eb"), hx("#6366f1"));
    mask=Image.new("L",(36*S,36*S),0); md=ImageDraw.Draw(mask); md.rounded_rectangle((0,0,36*S,36*S),10*S,fill=255)
    img.paste(logo,(16*S,46*S),mask)
    paste_plane(img, int(20*S), (255,255,255,255), 34*S, 64*S, 45)
    text(d,(60*S,57*S),"GeoPilot",BOLD(16),theme["fg"],anchor="lm")
    # online tag
    ot=(60*S,70*S); tw=text_w("online",REG(9));
    rrect(d,(60*S,72*S,60*S+46*S,72*S+16*S),8*S,fill=theme["ok"]); text(d,(83*S,80*S),"online",BOLD(8.5),(255,255,255,255),anchor="mm")
    # power chip
    pc_w=70*S; pc=(W-16*S-pc_w, 52*S, W-16*S, 80*S)
    rrect(d,pc,14*S,fill=theme["panel2"],outline=theme["border"],width=1*S)
    d.ellipse((pc[0]+12*S, (pc[1]+pc[3])//2-4*S, pc[0]+20*S,(pc[1]+pc[3])//2+4*S), fill=theme["ok"])
    text(d,((pc[0]+pc[2])//2+6*S,(pc[1]+pc[3])//2),"Aktiv",BOLD(10),theme["fg"],anchor="mm")

    # ---- planes on the map
    planes = [(0.30,0.30,40,"hi"),(0.55,0.45,70,"mid"),(0.20,0.62,120,"lo"),
              (0.72,0.38,200,"hi"),(0.62,0.70,300,"mid"),(0.42,0.52,90,"sel"),
              (0.82,0.60,150,"lo"),(0.86,0.28,20,"mid")]
    altcol={"lo":theme["alt_lo"],"mid":theme["alt_mid"],"hi":theme["alt_hi"],"sel":theme["accent"]}
    # trail + route for selected
    sx,sy=int(0.42*W),int(0.52*H)
    d.line([(int(0.30*W),int(0.66*H)),(int(0.36*W),int(0.59*H)),(sx,sy)], fill=theme["trail"], width=3*S, joint="curve")
    for (px,py,trk,kind) in planes:
        x,y=int(px*W),int(py*H)
        ring = (255,255,255,255) if kind=="sel" else theme.get("plane_ring")
        paste_plane(img, int((30 if kind=="sel" else 26)*S), altcol[kind], x, y, trk, ring)
        if theme.get("labels") or kind=="sel":
            lab = {"sel":"GEC8311","hi":"DLH4AB","mid":"RYR21","lo":"EWG7F"}.get(kind,"")
            if lab:
                text(d,(x+12*S,y-10*S),lab,BOLD(8),theme["lbl"],anchor="lm")
                text(d,(x+12*S,y-1*S),f"{trk*100} ft",REG(7),theme["lbl_dim"],anchor="lm")
    # airport
    ax,ay=int(0.66*W),int(0.50*H)
    d.ellipse((ax-9*S,ay-9*S,ax+9*S,ay+9*S),fill=theme["panel2"],outline=theme["accent"],width=2*S)
    paste_plane(img,int(13*S),theme["accent"],ax,ay,30)

    # ---- top search + chips (left zone)
    rz=62*S
    sb=(16*S, hb+10*S, W-rz, hb+10*S+44*S)
    rrect(d, sb, 12*S, fill=theme["panel2"], outline=theme["border"], width=1*S)
    # search icon
    scx=sb[0]+22*S; scy=(sb[1]+sb[3])//2
    d.ellipse((scx-7*S,scy-7*S,scx+5*S,scy+5*S), outline=theme["muted"], width=2*S)
    d.line((scx+4*S,scy+4*S,scx+9*S,scy+9*S), fill=theme["muted"], width=2*S)
    text(d,(sb[0]+38*S,scy),"Rufzeichen oder Kennzeichen",REG(11),theme["muted"],anchor="lm")
    # chips
    chips=[("Alle",True),("≥10k ft",False),("Steigt",False),("Sinkt",False),("Notfall",False)]
    cx=16*S; cy=sb[3]+10*S
    for lbl,on in chips:
        w=text_w(lbl,BOLD(9.5))+24*S
        if cx+w > W-rz: break
        box=(cx,cy,cx+w,cy+30*S)
        rrect(d,box, 15*S, fill=theme["accent"] if on else theme["panel2"], outline=None if on else theme["border"], width=1*S)
        text(d,(cx+w/2,cy+15*S),lbl,BOLD(9.5),(255,255,255,255) if on else theme["fg"],anchor="mm")
        cx+=w+8*S
    # ---- FAB column (right)
    fx=W-30*S; fy=hb+10*S+22*S
    for kind,on in [("layers",False),("tag",theme.get("labels",False)),("airport",False),("auto",True),("refresh",False)]:
        fab(img,d,theme,fx,fy,kind,on); fy+=52*S

    # ---- bottom sheet
    sh_y=H-70*S-300*S
    sheet=(0, sh_y, W, H-70*S)
    rrect(d, sheet, 20*S, fill=theme["sheet"])
    d.rectangle((0, sh_y+20*S, W, H-70*S), fill=theme["sheet"])  # square bottom into tabbar
    if theme.get("glass"):
        d.rectangle((0,sh_y,W,sh_y+3*S), fill=theme["accent"])
    # grabber
    d.rounded_rectangle((W//2-21*S, sh_y+9*S, W//2+21*S, sh_y+14*S), 3*S, fill=theme["border"])
    text(d,(20*S, sh_y+34*S),"FLÜGE IN SICHT",BOLD(10),theme["muted"],anchor="lm")
    cnt=(W-20*S-50*S, sh_y+26*S, W-20*S, sh_y+44*S)
    rrect(d,cnt,9*S,fill=theme["panel2"],outline=theme["border"],width=1*S)
    text(d,((cnt[0]+cnt[2])//2,(cnt[1]+cnt[3])//2),"24",BOLD(10),theme["accent"],anchor="mm")
    # flight cards
    rows=[("GEC8311","FRA → PEK","38.000 ft · 902 km/h · 12 km","#"),
          ("EWG7F","IBZ → DUS","36.275 ft · 843 km/h · 25 km","#"),
          ("RYR21","STN → BCN","37.000 ft · 870 km/h · 31 km","#")]
    ry=sh_y+54*S
    for cs,route,meta,_ in rows:
        card=(12*S, ry, W-12*S, ry+72*S)
        rrect(d,card, 14*S, fill=theme["card"], outline=theme["border"], width=1*S)
        paste_plane(img,int(18*S), theme["alt_hi"], card[0]+24*S, ry+24*S, 45)
        text(d,(card[0]+44*S, ry+22*S), cs, BOLD(13), theme["fg"], anchor="lm")
        text(d,(W-26*S, ry+22*S), "›", BOLD(16), theme["muted"], anchor="rm")
        text(d,(card[0]+44*S, ry+44*S), route+"   ·   "+meta, REG(9.5), theme["muted"], anchor="lm")
        ry+=80*S

    # ---- tab bar
    tab_bar(img, d, theme, active="plane")

    # ---- variant badge (top center, for the comparison only)
    bw=150*S
    bb=(W//2-bw//2, 6*S, W//2+bw//2, 6*S)  # placeholder (drawn in compose)
    return img

# text width helper using a scratch draw
_scratch = ImageDraw.Draw(Image.new("RGB",(10,10)))
def text_w(s, font):
    return _scratch.textlength(s, font=font)

# -------- THEMES ----------------------------------------------------
A = dict(  # FR24 Classic Dark
    name="A · FR24 Classic",
    bg=hx("#0b1b2b"), map=hx("#1b2c3d"), land=hx("#24384b"), water=hx("#16283a"),
    road=hx("#3c5168"), road_case=None, map_label=hx("#6f8aa3"),
    panel=hx("#0e1c2b"), panel2=hx("#16283a"), sheet=hx("#0e1c2b"), card=hx("#16283a"),
    border=hx("#27405a"), fg=hx("#eef4fb"), muted=hx("#8aa1b8"),
    accent=hx("#f5a623"), ok=hx("#34d399"), ok_bg=hx("#10b98133"),
    fab=hx("#16283a"), fab_fg=hx("#cfe0f0"),
    alt_lo=hx("#f59e0b"), alt_mid=hx("#fbbf24"), alt_hi=hx("#ffd96b"),
    trail=hx("#f5a623"), lbl=hx("#ffffff"), lbl_dim=hx("#ffd96b"),
    sb_fg=hx("#eef4fb"), header_solid=True, labels=True, plane_ring=hx("#0b1b2b"),
)
B = dict(  # Modern Glass Dark
    name="B · Modern Glass",
    bg=hx("#0b1220"), map=hx("#0d1626"), land=hx("#14203a"), water=hx("#0a1830"),
    road=hx("#27324a"), road_case=None, map_label=hx("#5b6b85"),
    panel=hx("#101a2eea"), panel2=hx("#1a2740cc"), sheet=hx("#101a2e"), card=hx("#16223b"),
    border=hx("#2a3a59"), fg=hx("#f1f5f9"), muted=hx("#94a3b8"),
    accent=hx("#22d3ee"), ok=hx("#34d399"), ok_bg=hx("#10b98133"),
    fab=hx("#1a2740"), fab_fg=hx("#cbd5e1"),
    alt_lo=hx("#fb923c"), alt_mid=hx("#34d399"), alt_hi=hx("#38bdf8"),
    trail=hx("#38bdf8"), lbl=hx("#ffffff"), lbl_dim=hx("#7dd3fc"),
    sb_fg=hx("#f1f5f9"), header_solid=False, glass=True, labels=False, plane_ring=hx("#0b1220"),
)
C = dict(  # Light / Day
    name="C · Hell / Tag",
    bg=hx("#eef2f8"), map=hx("#e6ecf3"), land=hx("#f4f7fb"), water=hx("#cfe0f2"),
    road=hx("#ffffff"), road_case=hx("#d2dbe8"), map_label=hx("#90a0b5"),
    panel=hx("#ffffff"), panel2=hx("#ffffff"), sheet=hx("#ffffff"), card=hx("#f5f8fc"),
    border=hx("#e2e8f0"), fg=hx("#0b1220"), muted=hx("#64748b"),
    accent=hx("#2563eb"), ok=hx("#16a34a"), ok_bg=hx("#16a34a22"),
    fab=hx("#ffffff"), fab_fg=hx("#334155"),
    alt_lo=hx("#f59e0b"), alt_mid=hx("#0ea5e9"), alt_hi=hx("#6366f1"),
    trail=hx("#2563eb"), lbl=hx("#0b1220"), lbl_dim=hx("#475569"),
    sb_fg=hx("#0b1220"), header_solid=True, labels=True, plane_ring=hx("#ffffff"),
)
# land/water polygon sets (shared shapes, recolored per theme)
LAND=[[(0.0,0.0),(0.5,0.0),(0.42,0.25),(0.2,0.4),(0.0,0.45)],
      [(0.55,0.1),(1.0,0.0),(1.0,0.4),(0.7,0.5),(0.5,0.35)],
      [(0.0,0.55),(0.3,0.5),(0.55,0.62),(0.4,0.85),(0.1,1.0),(0.0,1.0)],
      [(0.6,0.6),(1.0,0.55),(1.0,1.0),(0.55,1.0),(0.5,0.8)]]
WATER=[[(0.42,0.25),(0.55,0.35),(0.5,0.55),(0.3,0.5),(0.2,0.4)],
       [(0.5,0.8),(0.6,0.6),(0.55,1.0),(0.42,1.0)]]
for t in (A,B,C):
    t["land_polys"]=LAND; t["water_polys"]=WATER

os.makedirs("/home/user/dhl/mockups", exist_ok=True)
out=[]
for key,theme in (("A",A),("B",B),("C",C)):
    im=render(key, theme).convert("RGB")
    p=f"/home/user/dhl/mockups/mock_{key}.png"
    im.save(p)
    out.append(p)
    print("wrote", p, im.size)

# ---- side-by-side comparison board ----
pad=20; lblh=46
thumbs=[Image.open(p) for p in out]
tw,th=thumbs[0].size
board=Image.new("RGB",(tw*3+pad*4, th+lblh+pad*2), (15,18,28))
bd=ImageDraw.Draw(board)
names=["A · FR24 Classic (dunkel/amber)","B · Modern Glass (dunkel/cyan)","C · Hell / Tag (blau)"]
for i,(thmb,nm) in enumerate(zip(thumbs,names)):
    x=pad+i*(tw+pad)
    board.paste(thmb,(x,lblh))
    bd.text((x+tw//2, 22), nm, font=BOLD(13), fill=(240,244,250), anchor="mm")
board.save("/home/user/dhl/mockups/compare.png")
print("wrote compare board", board.size)
