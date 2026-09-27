from PIL import Image, ImageDraw, ImageFont
import os
SRC = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'oaci-symboles')
names = ['piste-dur','bande','helistation','hydroaerodrome','civil-a','civil-b','mixte-a','mixte-b','militaire-a','militaire-b','desaffecte','prive','codage-symbole','ifr-ad','ifr-helico']
CELL_W, CELL_H, PAD = 260, 200, 12
sheet = Image.new('RGB', (CELL_W*3, CELL_H*5), 'white')
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 15)
except Exception:
    font = ImageFont.load_default()
for i, n in enumerate(names):
    col, row = i % 3, i // 3
    x0, y0 = col*CELL_W, row*CELL_H
    d.rectangle([x0+PAD, y0+PAD, x0+CELL_W-PAD, y0+CELL_H-30], outline='#cccccc')
    ic = Image.open(os.path.join(SRC, n + '.png'))
    maxw, maxh = CELL_W-2*PAD-10, CELL_H-30-2*PAD-10
    if ic.width > maxw or ic.height > maxh:
        r = min(maxw/ic.width, maxh/ic.height)
        ic = ic.resize((int(ic.width*r), int(ic.height*r)), Image.LANCZOS)
    bg = Image.new('RGBA', (CELL_W-2*PAD, CELL_H-30-2*PAD), (240,240,240,255))
    bg.paste(ic, ((bg.width-ic.width)//2, (bg.height-ic.height)//2), ic)
    sheet.paste(bg.convert('RGB'), (x0+PAD, y0+PAD))
    d.text((x0+PAD+2, y0+CELL_H-26), n, fill='black', font=font)
out = os.path.join(os.path.dirname(__file__), 'planche-symboles.png')
sheet.save(out)
print('planche:', sheet.size, '→', out)
