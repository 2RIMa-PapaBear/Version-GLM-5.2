# Extraction des symboles « terrains » de la légende SCAN-OACI (IGN)

Objectif : récupérer les pictogrammes aérodromes de la légende officielle
(GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN-OACI-legend.pdf, édition 2021) pour la
représentation « carte OACI » de la carte régionale — test/oaci-aerodromes.

Symboles extraits (assets/oaci-symboles/, PNG transparents, encre #141414) :
piste-dur, bande, helistation, hydroaerodrome, civil-a/b, mixte-a/b,
militaire-a/b, desaffecte, prive, codage-symbole, ifr-ad, ifr-helico.
« -a/-b » : la légende montre DEUX variantes par ligne civil/mixte/militaire
(piste dure / non dure — à confirmer par le pilote sur la planche).

## Pipeline (rejouable)

1. `node test/oaci-extract/render-page1.mjs`
   Rend la page 1 du PDF en PNG (×6, 1871×4252) via pdfjs-dist + @napi-rs/canvas
   (installés SANS --save : rien dans package.json). Source PDF par défaut :
   G:\Bureau\GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN-OACI-legend.pdf (surcharge :
   1ᵉʳ argument).
2. `python test/oaci-extract/extract-symboles.py`
   Découpe les 15 fenêtres (coordonnées pt établies par corrélations
   libellés-pdfjs ↔ amas d'encre PIL), retire les traits du cadre (rangées/
   colonnes sombres >92 %), rogne à l'encre, fond blanc → alpha, encre
   recoloriée quasi-noire opaque.
3. `python test/oaci-extract/planche.py`
   Planche-contact étiquetée (damier = transparence) :
   test/oaci-extract/planche-symboles.png — VALIDATION PILOTE.

## Notes

- La légende est vectorielle (aucune image embarquée page 1) → rendu
  pdfjs obligatoire (pdftoppm/pdfimages absents ; pdftotext présent est
  la version xpdf, sans -bbox — les positions texte viennent de pdfjs).
- Le "H" des lignes CIVIL/MIXTE/MILITAIRE fait partie du symbole (lettre
  dans le pictogramme), pas un libellé.
