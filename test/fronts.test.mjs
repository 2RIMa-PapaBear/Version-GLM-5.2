// Tests du module CARTES DES FRONTS (worker parseFrontsLayers) — capture
// RÉELLE du 17/09 : la page anim_carte_front.php liste chaque échéance deux
// fois (mode=pdf dans les cellules, mode=img dans le tableau d'animation,
// puis le sens retour). Le parseur doit dédoublonner et trier. Tourne via
// `npm test`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontsLayers } from '../worker/index.js';

// Capture réelle (recon 17/09, session AEROWEB du pilote) — extrait
// représentatif : 8 échéances x 6 h, allers pdf+img puis retours img.
const CAPTURE = `
<td onclick='stop_anim_demande=true;vu_image_anim(0);'>jeu. 17<br>sept. 06:00<img onclick="return newwindow('affiche_image.php?type=front/europeouest&date=20260917060000&mode=pdf&comment=');" ></td>
<td onclick='vu_image_anim(1);'>12:00<img onclick="return newwindow('affiche_image.php?type=front/europeouest&date=20260917120000&mode=pdf&comment=');" ></td>
<script>
tab[0] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260917060000&mode=img&comment=';
tab[1] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260917120000&mode=img&comment=';
tab[2] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260917180000&mode=img&comment=';
tab[3] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260918000000&mode=img&comment=';
tab[4] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260918120000&mode=img&comment=';
tab[5] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260919000000&mode=img&comment=';
tab[6] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260919120000&mode=img&comment=';
tab[7] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260920000000&mode=img&comment=';
// sens retour de l'animation (duplicatas) :
rev[0] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260920000000&mode=img&comment=';
rev[7] = 'affiche_image.php?time=1789672768&type=front/europeouest&date=20260917060000&mode=img&comment=';
</script>`;

describe('parseFrontsLayers (page d\'animation des fronts)', () => {
    test('capture réelle : une couche, échéances dédoublonnées et triées', () => {
        const layers = parseFrontsLayers(CAPTURE);
        assert.equal(layers.length, 1);
        const l = layers[0];
        assert.equal(l.key, 'fronts');
        assert.equal(l.type, 'front/europeouest');
        assert.equal(l.label, 'Europe ouest');
        assert.equal(l.echeances.length, 8, 'dédoublonnage des allers/retours');
        assert.deepEqual(l.echeances.map(e => e.utc.slice(8, 10) + 'h UTC'),
            ['06h UTC', '12h UTC', '18h UTC', '00h UTC', '12h UTC', '00h UTC', '12h UTC', '00h UTC']);
        assert.equal(l.echeances[0].utc, '20260917060000', 'tri croissant');
        assert.equal(l.echeances[7].utc, '20260920000000');
    });

    test('HTML inattendu → [] (page de login, erreur 500…)', () => {
        assert.deepEqual(parseFrontsLayers('<html>merci de vous reconnecter</html>'), []);
        assert.deepEqual(parseFrontsLayers(''), []);
    });

    test('type hors whitelist fronts rejeté (sigwx/wintemp restent TEMSI)', () => {
        const out = parseFrontsLayers("x='affiche_image.php?type=sigwx/fr/france&date=20260917120000&mode=img&comment=';");
        assert.deepEqual(out, []);
    });
});
