# 📝 Notes locales

Un équivalent de Notion, **auto-hébergé en local**, sans aucune dépendance : un petit serveur Node.js et une interface en JavaScript pur. Toutes les données restent sur ta machine, dans un simple fichier JSON.

## Démarrage

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm start          # ou : node server.js
```

Puis ouvre <http://localhost:3000>.

| Variable d'environnement | Défaut        | Rôle                                                        |
| ------------------------ | ------------- | ----------------------------------------------------------- |
| `PORT`                   | `3000`        | Port d'écoute                                               |
| `HOST`                   | `127.0.0.1`   | Mettre `0.0.0.0` pour y accéder depuis le réseau local      |
| `DATA_DIR`               | `./data`      | Dossier où est stocké `db.json`                             |

> ⚠️ Il n'y a pas d'authentification : n'expose pas le serveur sur Internet.

**Sauvegarde** : copie simplement `data/db.json`.

## Fonctionnalités

### Éditeur de blocs
- **Menu `/`** : tape `/` puis filtre (`/titre`, `/h2`, `/liste`, `/page`, `/base`…), navigue avec ↑ ↓, valide avec Entrée.
- Blocs : texte, **titres H1 / H2 / H3**, liste à puces, liste numérotée, cases à cocher, bloc dépliant, citation, encadré, code, séparateur, sous-page, base de données, lien vers une page.
- **Raccourcis Markdown** en début de ligne :

  | Saisie            | Résultat         |
  | ----------------- | ---------------- |
  | `# ` `## ` `### ` | Titre 1 / 2 / 3  |
  | `- ` `* ` `+ `    | Liste à puces    |
  | `1. `             | Liste numérotée  |
  | `[] ` / `[x] `    | Case à cocher    |
  | `> ` ou `" `      | Citation         |
  | `>> `             | Bloc dépliant    |
  | ` ``` `           | Bloc de code     |
  | `---`             | Séparateur       |

- Mise en forme : **Ctrl+B**, *Ctrl+I*, Ctrl+U, Ctrl+Maj+S (barré), Ctrl+E (code), Ctrl+K sur une sélection (lien) — ou la barre flottante qui apparaît à la sélection.
- **Tab / Maj+Tab** pour indenter / désindenter, **Ctrl+D** pour dupliquer un bloc.
- Glisser-déposer des blocs via la poignée `⋮⋮` (un clic dessus ouvre le menu : supprimer, dupliquer, transformer en…).
- Coller du Markdown multi-lignes le convertit en blocs.

### Pages
- **Pages imbriquées à l'infini**, arborescence dans la barre latérale, fil d'Ariane.
- Icône emoji, mode pleine largeur, déplacement vers une autre page, export Markdown.
- **Corbeille** avec restauration (et « Annuler » juste après une suppression).
- Recherche plein texte : **Ctrl+K**.

### Bases de données
- Vues **Tableau** et **Kanban** (glisser les cartes entre colonnes).
- Propriétés : texte, nombre, sélection, multi-sélection, date, case à cocher, URL — renommer, changer le type (avec conversion des valeurs), supprimer.
- Tri par colonne, filtre texte.
- Chaque ligne est une **page à part entière** : ouvre-la pour éditer ses propriétés et y écrire du contenu.

### Divers
- Thème clair / sombre, interface responsive (mobile).
- Sauvegarde automatique.

## Structure

```
server.js          Serveur HTTP + API REST (/api/pages) + stockage JSON
public/index.html  Squelette de l'interface
public/app.js      Éditeur, barre latérale, bases de données
public/style.css   Styles
data/db.json       Tes données (créé au premier lancement, ignoré par git)
```

### API

| Méthode  | Route             | Description                                   |
| -------- | ----------------- | --------------------------------------------- |
| `GET`    | `/api/pages`      | Toutes les pages                              |
| `GET`    | `/api/pages/:id`  | Une page                                      |
| `POST`   | `/api/pages`      | Créer une page (`parentId`, `type`, `title`…) |
| `PATCH`  | `/api/pages/:id`  | Modifier des champs                           |
| `DELETE` | `/api/pages/:id`  | Supprimer définitivement (avec sous-pages)    |
