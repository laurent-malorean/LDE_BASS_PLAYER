import { h } from './ui.js';
import { charger } from './etat.js';
import { arreterTout } from './composants.js';
import * as pages from './pages.js';

const principal = document.getElementById('principal');
const NAV = [['', 'Accueil'], ['theorie', 'Théorie'], ['manche', 'Le manche'], ['exercices', 'Exercices'], ['metronome', 'Métronome'], ['accordeur', 'Accordeur'], ['parametres', 'Paramètres']];

function menu(courant) {
  document.getElementById('menu').replaceChildren(...NAV.map(([k, t]) =>
    h('a', { href: '#/' + k, class: courant === k ? 'actif' : '', 'aria-current': courant === k ? 'page' : null }, t)));
}

async function route() {
  arreterTout();
  const [premier = '', ...reste] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  menu(premier);
  principal.replaceChildren();
  window.scrollTo(0, 0);
  try {
    if (premier === '') await pages.accueil(principal);
    else if (premier === 'theorie' || premier === 'manche') await (reste.length ? pages.lecon(principal, [premier, ...reste]) : pages.listeLecons(principal, [premier]));
    else if (premier === 'exercices') await (reste.length ? pages.exercice(principal, reste) : pages.exercices(principal));
    else if (premier === 'metronome') pages.metronome(principal);
    else if (premier === 'accordeur') await pages.accordeur(principal);
    else if (premier === 'parametres') await pages.parametres(principal);
    else principal.append(h('p', {}, 'Page introuvable.'));
  } catch (e) {
    console.error(e);
    principal.append(h('p', { class: 'erreur' }, 'Erreur : ' + e.message));
  }
}

try {
  await charger();
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', arreterTout);
  await route();
} catch (e) {
  principal.append(h('p', { class: 'erreur' }, 'Impossible de joindre le serveur local : ' + e.message));
}
