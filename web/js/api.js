// Accès à l'API du serveur local (les données vivent dans des fichiers du dossier data/).
async function appel(chemin, options = {}) {
  const r = await fetch('/api/' + chemin, options);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erreur || `Erreur ${r.status}`);
  return r.json();
}
export const lire = (nom) => appel('data/' + nom);
export const ecrire = (nom, valeur) => appel('data/' + nom, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valeur) });
export const lister = (dossier) => appel('data?dir=' + dossier);
export const config = () => appel('config');
export const lecons = () => appel('lecons');
export const lecon = (cat, id) => appel(`lecons/${cat}/${id}`);
export const exercices = () => appel('exercices');
export const exercice = (id) => appel('exercices/' + id);
export const exporter = () => appel('export');
export const importer = (bundle) => appel('import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });

export const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Ajoute une activité au fichier de session du jour (sessions/AAAA-MM-JJ.json). */
export async function noterActivite(activite) {
  const nom = 'sessions/' + aujourdhui();
  const s = (await lire(nom)) ?? { date: aujourdhui(), activites: [] };
  s.activites.push({ heure: new Date().toTimeString().slice(0, 5), ...activite });
  s.minutes = Math.round(((s.minutes ?? 0) + (activite.minutes ?? 0)) * 10) / 10;
  await ecrire(nom, s);
}

/** Met à jour le fichier de l'exercice (exercices/<id>.json) : essais, meilleur tempo, historique. */
export async function noterExercice(id, essai) {
  const nom = 'exercices/' + id;
  const e = (await lire(nom)) ?? { id, essais: 0, meilleur_bpm: 0, historique: [] };
  e.essais++;
  if (essai.reussi) e.meilleur_bpm = Math.max(e.meilleur_bpm, essai.bpm);
  e.historique.push({ date: new Date().toISOString(), ...essai });
  e.historique = e.historique.slice(-100);
  await ecrire(nom, e);
  return e;
}
