"""Découpe les symboles aérodromes de la page 1 rendue (page1.png, échelle 6).
Voir README.md. Sortie : assets/oaci-symboles/*.png (transparents)."""
from PIL import Image
import os
img = Image.open(os.path.join(os.path.dirname(__file__), 'page1.png')).convert('L')
S = 6
W, H = img.size
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'oaci-symboles')
os.makedirs(OUT, exist_ok=True)
WINDOWS = [
    ('piste-dur',      157.5, 374.6, 197.5, 382.2),
    ('bande',          194.5, 374.6, 231.5, 383.2),
    ('helistation',    230.5, 376.8, 266.5, 385.2),
    ('hydroaerodrome', 265.5, 374.6, 310.5, 383.2),
    ('civil-a',        236.5, 412.5, 262.5, 436.5),
    ('civil-b',        271.5, 412.5, 297.5, 436.5),
    ('mixte-a',        236.5, 446.0, 262.5, 470.5),
    ('mixte-b',        271.5, 446.0, 297.5, 470.5),
    ('militaire-a',    238.5, 480.0, 260.5, 500.5),
    ('militaire-b',    274.5, 480.0, 296.5, 500.5),
    ('desaffecte',     154.5, 506.5, 175.5, 527.5),
    ('prive',          228.5, 506.0, 253.5, 529.5),
    ('codage-symbole', 37.5,  519.5, 58.5,  533.5),
    ('ifr-ad',         23.0, 566.0, 75.5,  584.5),
    ('ifr-helico',     179.5, 566.5, 226.5, 582.5),
]
def crop_icon(x0, y0, x1, y1):
    box = img.crop((int(x0*S), int(y0*S), min(int(x1*S), W), min(int(y1*S), H)))
    bw = box.point(lambda v: 0 if v < 140 else 255)
    data = bw.load()
    w, h = bw.size
    def mostly(seq): return sum(1 for v in seq if v == 0) / max(1, len(seq)) > 0.92
    for y in [y for y in range(h) if mostly([data[x, y] for x in range(w)])]:
        for x in range(w): data[x, y] = 255
    for x in [x for x in range(w) if mostly([data[x, y] for y in range(h)])]:
        for y in range(h): data[x, y] = 255
    bbox = bw.point(lambda v: 255 - v).getbbox()
    if not bbox: return None, 0
    ink = sum(1 for y in range(bbox[1], bbox[3]) for x in range(bbox[0], bbox[2]) if data[x, y] == 0)
    gray = box.crop(bbox)
    alpha = gray.point(lambda v: max(0, min(255, int((200 - v) * 255 / 140))))
    noir = Image.new('L', gray.size, 20)
    return Image.merge('RGBA', (noir, noir, noir, alpha)), ink
for name, x0, y0, x1, y1 in WINDOWS:
    ic, ink = crop_icon(x0, y0, x1, y1)
    if ic is None or ink < 80:
        print(f'{name:16} VIDE/INSUFFISANT (encre={ink})'); continue
    ic.save(os.path.join(OUT, name + '.png'))
    print(f'{name:16} {ic.size[0]}x{ic.size[1]} px  encre={ink}')
