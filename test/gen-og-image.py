# Génère og-image.png (1200×630, carte de partage Open Graph/Twitter).
# Usage : python test/gen-og-image.py   (régénérable si la marque change)
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (2, 6, 23)        # #020617 — fond sombre de l'app (theme-color)
ACCENT = (245, 158, 11)  # #f59e0b — ambre VFR
TXT = (248, 250, 252)    # #f8fafc
SUB = (148, 163, 184)    # #94a3b8
MUT = (100, 116, 139)    # #64748b
BORDER = (51, 65, 85)    # #334155

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

bold = lambda s: ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", s)
reg = lambda s: ImageFont.truetype("C:/Windows/Fonts/arial.ttf", s)

def fit(draw, text, font_fn, size, max_w):
    while size > 10:
        f = font_fn(size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 2
    return font_fn(size)

# --- Colonne droite : aperçu de l'app (capture existante) ---
shot = Image.open("docs/capture-meteo.png")
sh = 500
sw = round(shot.width * sh / shot.height)
shot = shot.resize((sw, sh), Image.LANCZOS)
sx, sy = W - sw - 50, (H - sh) // 2
img.paste(shot, (sx, sy))
d.rectangle([sx - 1, sy - 1, sx + sw, sy + sh], outline=BORDER, width=2)

# --- Colonne gauche : marque + accroche ---
LX, MAXW = 70, sx - 70 - 60
d.rectangle([LX, 168, LX + 120, 176], fill=ACCENT)
d.text((LX, 200), "Prévol", font=bold(96), fill=TXT)
d.text((LX, 330), "Météo aéronautique en temps réel", font=fit(d, "Météo aéronautique en temps réel", reg, 40, MAXW), fill=SUB)
d.text((LX, 400), "Décodeur METAR & TAF • Pilotes VFR • Gratuit", font=fit(d, "Décodeur METAR & TAF • Pilotes VFR • Gratuit", reg, 28, MAXW), fill=MUT)

img.save("og-image.png", optimize=True)
print(f"og-image.png : {img.size[0]}×{img.size[1]}")
