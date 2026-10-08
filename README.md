# 📝 Notes locales

Un équivalent de Notion, **auto-hébergé en local**, sans aucune dépendance : un petit serveur Node.js et une interface en JavaScript pur. Toutes les données restent sur ta machine, dans un simple fichier JSON.

## Démarrage

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent.

```bash
npm start          # ou : node server.js
```

Au premier lancement, le terminal te demande de **choisir un identifiant et un mot de passe**. Ouvre ensuite <http://localhost:3000> et connecte-toi.

Pour changer d'identifiant ou de mot de passe plus tard : `npm run set-password` (déconnecte tous les appareils). Le mot de passe peut aussi être changé depuis l'appli (👤 en bas de la barre latérale).

| Variable d'environnement | Défaut      | Rôle                                                                       |
| ------------------------ | ----------- | -------------------------------------------------------------------------- |
| `PORT`                   | `3000`      | Port d'écoute                                                              |
| `HOST`                   | `127.0.0.1` | `0.0.0.0` pour accepter les connexions venant d'autres machines            |
| `DATA_DIR`               | `./data`    | Dossier des données (`db.json`, `auth.json`, `sessions.json`)              |
| `AUTH_USER` / `AUTH_PASSWORD` | —      | Alternative à `set-password` (utile avec Docker ou un hébergeur)          |
| `TRUST_PROXY`            | —           | `1` si l'appli est derrière un reverse proxy (Caddy, Nginx…)               |
| `COOKIE_SECURE`          | —           | `1` pour forcer le cookie `Secure` (automatique en HTTPS via le proxy)     |
| `SESSION_DAYS`           | `30`        | Durée de validité d'une connexion                                          |

**Sauvegarde** : copie le dossier `data/`.

## Mettre en ligne sur Internet

Les données restent sur ta machine / ton serveur ; seul l'accès passe par Internet. **Utilise impérativement HTTPS**, sinon ton mot de passe circule en clair.

Le plus simple est [Caddy](https://caddyserver.com), qui obtient le certificat HTTPS tout seul. Avec un nom de domaine qui pointe vers ton serveur (ports 80 et 443 ouverts) :

```bash
# 1. Lancer l'appli (elle reste en écoute locale, seul Caddy est exposé)
TRUST_PROXY=1 npm start

# 2. Dans un autre terminal
caddy reverse-proxy --from notes.mondomaine.fr --to localhost:3000
```

Pour un accès depuis l'extérieur sans nom de domaine ni ouverture de port, un tunnel comme [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) ou [Tailscale](https://tailscale.com) fonctionne aussi (garder `TRUST_PROXY=1`).

### Sécurité intégrée
- Mot de passe haché avec **scrypt** (jamais stocké en clair), fichiers secrets en droits `600`.
- Session par cookie `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS ; seule l'empreinte du jeton est stockée côté serveur.
- **Anti brute-force** : après 5 essais ratés, l'adresse IP est bloquée (1 min, puis 2, 4… jusqu'à 1 h). Les échecs sont journalisés dans la console.
- Protection CSRF (vérification de l'origine + JSON obligatoire), en-têtes de sécurité (CSP stricte, anti-iframe, HSTS en HTTPS).
- Un seul compte : l'appli est pensée pour un usage personnel.

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
public/login.*     Page de connexion
public/style.css   Styles
data/              Tes données et ton compte (créé au premier lancement, ignoré par git)
```

### API

Toutes les routes demandent d'être connecté (`POST /api/login` avec `{username, password}`), sauf la connexion elle-même.

| Méthode  | Route             | Description                                   |
| -------- | ----------------- | --------------------------------------------- |
| `GET`    | `/api/pages`      | Toutes les pages                              |
| `GET`    | `/api/pages/:id`  | Une page                                      |
| `POST`   | `/api/pages`      | Créer une page (`parentId`, `type`, `title`…) |
| `PATCH`  | `/api/pages/:id`  | Modifier des champs                           |
| `DELETE` | `/api/pages/:id`  | Supprimer définitivement (avec sous-pages)    |
