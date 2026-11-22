---
name: commit
description: Commite (commits atomiques, format Open Commit) puis pousse les changements des deux dépôts du projet Bass Player — le moteur (public) et perso/ (données privées). À lancer explicitement avec /commit.
argument-hint: "[moteur | perso | tout]  (défaut : tout)"
disable-model-invocation: true
---

# /commit — commit atomique et push des deux dépôts

Le projet est composé de **deux dépôts git indépendants** :

| Dépôt | Dossier | Visibilité attendue |
|---|---|---|
| **moteur** | racine du projet | **public** |
| **perso** | `perso/` (ou `$BASS_PERSO`) | **privé** |

Argument : `$ARGUMENTS` — `moteur` (racine seule), `perso` (données seules), sinon `tout` (les deux).
Les règles de commit de [CLAUDE.md](../../../CLAUDE.md) s'appliquent : lis-les si besoin.

Traite les dépôts **l'un après l'autre**, de façon indépendante : l'échec de l'un ne doit pas
empêcher de traiter l'autre, mais doit apparaître clairement dans le bilan final.
Ne mélange jamais des fichiers des deux dépôts dans une même commande git ni un même commit.

## 0. Localiser les dépôts et vérifier la sécurité

1. Moteur : la racine du projet. Vérifie `git rev-parse --show-toplevel`.
2. Perso : `$BASS_PERSO` s'il est défini, sinon `./perso`. **Vérifie que ce dossier est bien la racine de
   son propre dépôt** : `git -C <perso> rev-parse --show-toplevel` doit renvoyer ce dossier lui-même.
   Si ce n'est pas le cas (pas de dépôt, ou il remonte vers le moteur) : ne commite rien dedans, signale-le.
3. **Garde-fou de confidentialité** — avant tout push de `perso/`, exécute
   `gh repo view --json visibility,nameWithOwner` depuis `perso/`. Si la visibilité n'est **pas** `PRIVATE`
   (ou si elle est introuvable), **arrête-toi pour ce dépôt** et préviens l'utilisateur : des données
   personnelles ne doivent jamais partir vers un dépôt public.
4. Garde-fou inverse pour le moteur : si `git ls-files` ou les fichiers à commiter contiennent
   `perso/`, `player.md`, `config.yml`, `data/`, `backups/` ou un fichier de secrets
   (`.env`, `*.pem`, `credentials*`, `.claude/settings.local.json`), **ne les commite pas** : signale-les.

## 1. Pour chaque dépôt

### a. État
`git status --short` et `git diff` (non indexé + indexé). S'il n'y a **rien à commiter** : saute à
l'étape *push* (il peut rester des commits locaux non poussés : `git rev-list --count @{u}..HEAD`).

### b. Vérification (moteur seulement)
Si des fichiers de code ont changé (`server/`, `web/`, `test/`, `package*.json`) : lance `npm test`.
S'il échoue, **ne commite pas ce code** et affiche l'échec. Les changements de pure documentation ou de
cours/exercices (`content/`, `*.md`) sont aussi validés par ces tests : lance-les quand même.

### c. Découper en commits atomiques
Regroupe les modifications par **changement logique unique** (une fonctionnalité, un correctif, un
refactoring, un lot de cours, une mise à jour de docs…). Pour chaque groupe :

1. Indexe **uniquement** les fichiers du groupe, par chemin explicite : `git add -- <fichiers>`.
   Jamais `git add -A` ni `git add .`. Si un même fichier mélange plusieurs changements, découpe-le avec
   `git add -p` (ou explique qu'il ne peut être séparé).
2. Un test qui prouve un correctif va dans le **même commit** que le correctif.
3. Commite avec un message **Open Commit** (Conventional Commits) :

       <type>(<portée>): <description>

       <corps optionnel : pourquoi, pas comment>

   - types : `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`
   - description : anglais, impératif, minuscules, sans point final, ≤ 72 caractères
   - rupture : `!` après le type/portée + paragraphe `BREAKING CHANGE:`
   - termine le message par la ligne d'attribution `Co-Authored-By` fournie par la session, si elle existe
   - passe le message avec plusieurs `-m` ou un here-doc, pour garder les lignes vides intactes
4. Vérifie avec `git log --oneline -n <k>` que les commits sont créés, puis `git status --short` : l'arbre
   doit être propre (sinon traite ce qui reste).
5. N'utilise jamais `--no-verify`, `--amend` sur un commit déjà poussé, ni `git reset --hard`.

#### Portées conseillées
- **Moteur** : `server`, `config`, `storage`, `audio`, `pitch`, `tab`, `fretboard`, `ui`, `content`, `deps`, `skills`.
- **Perso** (données personnelles, types `chore`/`feat`) :
  - `sessions/AAAA-MM-JJ.json` → `chore(data): log practice session AAAA-MM-JJ`
  - `exercices/*.json` → `chore(data): update exercise progress`
  - `progression.json` → `chore(data): update lesson progress`
  - `quiz.json` → `chore(data): update quiz stats`
  - `reglages.json` → `chore(config): update personal settings`
  - `player.md`, `config.yml` → `feat(profile): …` / `chore(config): …`
  - `mes-tablatures/*.yml` → `feat(tabs): add <nom de la tablature>`
  Si plusieurs sessions du même type sont modifiées en même temps, un seul commit par type suffit.

### d. Pousser
1. `git push`. S'il n'y a pas encore de branche amont : `git push -u origin HEAD`.
2. **Jamais de `--force`** (ni `--force-with-lease`). Si le push est refusé (branche distante en avance) :
   n'essaie pas de forcer ; affiche l'erreur et propose `git pull --rebase` à l'utilisateur.
3. Vérifie ensuite : `git status -sb` ne doit plus indiquer `ahead`, et `git rev-list --count @{u}..HEAD` doit valoir 0.

## 2. Bilan final

Termine par un court tableau, un dépôt par ligne :

| Dépôt | Commits créés | Poussé | Remarque |
|---|---|---|---|

- Liste les messages de commit créés (`git log --oneline`).
- Indique précisément ce qui a été **ignoré ou bloqué** (tests en échec, dépôt perso non privé, secret détecté,
  push refusé, rien à commiter) et ce que l'utilisateur doit faire.
- Ne prétends jamais qu'un push a réussi sans l'avoir vérifié à l'étape *d.3*.
