# Bass Player

Application web locale pour apprendre la basse : théorie, manche, tablatures interactives,
métronome, accordeur, écoute au micro.

## Démarrer

    npm install
    npm start                      # ouvre http://localhost:3000
    npm start -- --port 4000       # autre port (ou PORT=4000 npm start, ou serveur.port dans config.yml)
    npm test

## Moteur et données personnelles

Deux parties indépendantes, prévues pour deux dépôts git :

| | Dépôt | Contenu |
|---|---|---|
| **Moteur** | public | `server/`, `web/`, `content/` (cours et exercices), `test/`, `config.example.yml`, `player.example.md` |
| **Tes données** | privé | `perso/` : `player.md`, `config.yml`, `data/`, `backups/` |

Le dossier `perso/` est ignoré par le moteur. Il se crée tout seul au premier lancement à partir des
fichiers `*.example.*`. Pour le placer ailleurs (par exemple ton dépôt privé cloné à côté) :

    npm start -- --perso ../bass-data      # ou BASS_PERSO=../bass-data npm start

| Dans `perso/` | Rôle |
|---|---|
| `player.md` | Ton profil : main dominante, basse, niveau, notation des notes |
| `config.yml` | Configuration (port, audio, micro, sauvegardes…) — modèle : `config.example.yml` |
| `data/` | Progression, sessions du jour, un fichier par exercice, quiz, réglages |
| `data/mes-tablatures/` | Tes propres tablatures (`.yml`, même format que `content/exercices/`) |
| `backups/` | Copie automatique de `data/` (une par jour, 30 conservées), non versionnée |

## Format d'une tablature

    titre: Mon exercice
    bpm: 60
    chiffrage: "4/4"
    notes: "E0 A3/0.5 A5/0.5 -/1 D2 | G5"

`E0` = corde de Mi à vide, `A3` = corde de La frette 3, `/0.5` = durée en temps (1 par défaut),
`-` = silence, `|` = barre de mesure. Les doigtés (main de frette, i/m) sont calculés automatiquement.
Mets les textes contenant « : » entre guillemets.

## Écrire une leçon

Markdown avec en-tête `titre`, `resume`. Blocs interactifs : `fretboard`, `tab`, `quiz`, `mains`
(en bloc de code avec ce nom comme langage). Variables : `{{main_pince}}`, `{{main_frette}}`, `{{dominante}}`.
