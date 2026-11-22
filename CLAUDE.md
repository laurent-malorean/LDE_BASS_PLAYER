# Bass Player — instructions pour Claude

Application web locale pour apprendre la basse (théorie, manche, tablatures interactives, métronome,
accordeur, écoute au micro). L'utilisateur est **droitier**, joue une basse **4 cordes short-scale** (E-A-D-G).
Langue de l'interface, des cours et des échanges : **français**.

## Règles de commit (obligatoires)

### Commits atomiques

- **Un commit = un changement logique unique**, qui compile et dont les tests passent.
- Ne jamais mélanger dans un même commit : une fonctionnalité et un correctif, du refactoring et du
  comportement, du code et des cours sans rapport, ou des changements dans le moteur et dans `perso/`.
- Plusieurs modifications distinctes dans l'arbre de travail → plusieurs commits (utiliser `git add -p`
  ou ajouter les fichiers un par un), jamais un seul `git add -A` fourre-tout.
- Un test qui prouve un correctif va dans le **même commit** que le correctif.
- Avant de committer : `npm test` doit passer.

### Format Open Commit (Conventional Commits, comme le générateur OpenCommit)

    <type>(<portée>): <description>

    <corps optionnel : pourquoi, pas comment>

- **Types** : `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- **Portée** (optionnelle mais conseillée) : `server`, `audio`, `pitch`, `tab`, `fretboard`, `ui`,
  `content`, `config`, `storage`, `deps`…
- **Description** : à l'impératif, en minuscules, sans point final, 72 caractères maximum.
- **Langue** : anglais pour la ligne de titre (comportement par défaut d'OpenCommit) ; le corps peut
  être en français ou en anglais.
- Rupture de compatibilité : `!` après le type/portée (`feat(config)!: …`) et paragraphe `BREAKING CHANGE:`.
- Exemples : `feat(audio): add count-in before tablature playback`,
  `fix(config): stop mutating shared defaults`, `docs(content): add bass posture lesson`.

## Séparation moteur / données personnelles

Le projet est conçu pour devenir **deux dépôts** :

| Dépôt | Visibilité | Contenu |
|---|---|---|
| Moteur (ce dépôt) | **public** | `server/`, `web/`, `content/` (cours), `test/`, `*.example.*`, docs |
| Données | **privé** | `perso/` : `player.md`, `config.yml`, `data/`, `backups/` |

- `perso/` est dans le `.gitignore` du moteur : **ne jamais committer son contenu dans le dépôt moteur**.
- Le moteur lit le dossier perso via `--perso <chemin>`, la variable `BASS_PERSO`, sinon `./perso`.
  Au premier lancement il le crée à partir de `config.example.yml` et `player.example.md`.
- Le moteur ne doit **contenir aucune donnée personnelle** (nom, e-mail, profil réel, progression) :
  les exemples restent génériques. Les cours (`content/`) font partie du moteur.
- Les chemins locaux ne sont pas envoyés au navigateur (`/api/config` retire `dossiers` et `perso`).
- Chaque dépôt a son propre historique : les commits du moteur et ceux de `perso/` sont toujours séparés.

## Commandes

    npm start                    # http://localhost:3000
    npm start -- --port 4000     # ou PORT=4000, ou serveur.port dans perso/config.yml
    npm start -- --perso ../bass-data
    npm test                     # tests unitaires et d'intégration (node:test)

## Architecture

- `server/` : Node sans framework. `config.js` (config + `player.md`, priorité CLI/env > fichier > défauts),
  `storage.js` (un fichier JSON par donnée, écriture atomique, sauvegardes tournantes), `content.js`, `index.js`.
- `web/` : JavaScript natif (modules ES, sans build), SVG pour le manche et la tablature, Web Audio pour le son.
- Dépendances volontairement minimales (`yaml`, `marked`). Ne pas en ajouter sans raison forte.
- `node_modules` est un lien vers `node_modules.nosync` (le dossier est dans iCloud). À refaire après un
  `npm install` sur une autre machine.

## Pièges connus

- **YAML** : un texte contenant « : » doit être entre guillemets (exercices `.yml` et en-têtes des leçons).
  Les tests le vérifient pour le contenu du dépôt.
- Format d'une tablature : `E0 A3/0.5 -/1 | D2` (corde+frette, `/durée` en temps, `-` silence, `|` mesure).
- Ne jamais modifier les objets de valeurs par défaut partagés (cloner avant de fusionner).
- Écritures de données : toujours via `Storage` (noms validés, écriture atomique), jamais `fs` direct.

## Qualité

- Toute logique nouvelle (parsing, audio, stockage, config) vient avec un test.
- Vérifier visuellement les changements d'interface (capture avec Chrome headless) ; le son et le micro
  ne se testent pas en automatique : le dire explicitement plutôt que de prétendre l'avoir vérifié.
