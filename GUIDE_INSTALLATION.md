# Guide d'installation — Inventaire GéoConsulting

Application web d'inventaire du matériel, utilisable sur le téléphone (Android) et sur ordinateur.

- **Hébergement de l'application** : GitHub Pages (gratuit)
- **Base de données, comptes et photos** : Supabase (gratuit)

**Durée :** environ 45 minutes, à faire une seule fois, de préférence sur un ordinateur.
**Il vous faut :** une adresse email, le dossier `inventaire-geoconsulting` décompressé, et une connexion Internet.

> Tous les fichiers de l'application sont **au même niveau, sans sous-dossier** : il suffit de les sélectionner tous et de les envoyer en une fois sur GitHub.

---

## Vue d'ensemble

| Étape | Où | Ce qu'on fait |
|---|---|---|
| 1 | GitHub | Mettre l'application en ligne (elle s'ouvre d'abord en **mode démo**) |
| 2 | Supabase | Créer la base de données avec le script fourni |
| 3 | Supabase | **Fermer les inscriptions** (sécurité, obligatoire) |
| 4 | Supabase | Créer les comptes des 3 utilisateurs |
| 5 | GitHub | Relier l'application à Supabase (fichier `config.js`) |
| 6 | Téléphones | Installer l'application sur l'écran d'accueil |
| 7 | *Optionnel* | Activer la lecture des plaques par IA |
| 8 | Application | Importer l'ancien fichier Excel |

---

## Étape 1 — Mettre l'application en ligne avec GitHub Pages

1. Allez sur **github.com** et créez un compte gratuit (ou connectez-vous).
2. En haut à droite, cliquez sur **+** puis **New repository**.
   - *Repository name* : `inventaire`
   - Cochez **Public**. L'offre gratuite de GitHub Pages l'exige. Le code sera visible, mais **aucune donnée** ne s'y trouve : les fiches restent protégées dans Supabase.
   - Cliquez sur **Create repository**.
3. Sur la page du dépôt, cliquez sur le lien **uploading an existing file** (ou sur **Add file**, puis **Upload files**).
4. Cliquez sur **choose your files**. Dans la fenêtre qui s'ouvre, allez dans le dossier `inventaire-geoconsulting`, appuyez sur **Ctrl + A** pour sélectionner **les 30 fichiers**, puis cliquez sur **Ouvrir**.
5. Attendez que les 30 fichiers apparaissent dans la liste, puis cliquez sur **Commit changes**.
   > Si le dépôt contenait déjà des fichiers de même nom, ils sont simplement remplacés.
6. Allez dans **Settings** (onglet du dépôt), puis **Pages** dans le menu de gauche.
   - *Source* : **Deploy from a branch**
   - *Branch* : **main** et **/ (root)**, puis **Save**.
7. Attendez 1 à 2 minutes et rechargez la page. L'adresse de l'application apparaît en haut :
   `https://VOTRE-NOM-GITHUB.github.io/inventaire/`

✅ **Vérification :** ouvrez cette adresse sur votre téléphone. L'application s'affiche avec la mention **« Mode démo »**. Vous pouvez déjà l'essayer, mais en mode démo les fiches restent sur le téléphone et ne sont pas partagées.

---

## Étape 2 — Créer la base de données Supabase

1. Allez sur **supabase.com**, cliquez sur **Start your project** et connectez-vous (le bouton « Continue with GitHub » est le plus simple).
2. Cliquez sur **New project** :
   - *Name* : `inventaire-geoconsulting`
   - *Database Password* : cliquez sur **Generate a password**, puis **notez-le en lieu sûr**.
   - *Region* : **West EU (Paris)**, la plus proche du Niger.
   - Cliquez sur **Create new project**, puis attendez environ 2 minutes.
3. Dans le menu de gauche, ouvrez **SQL Editor**.
4. Sur votre ordinateur, ouvrez le fichier `installation-supabase.sql` avec le Bloc-notes. Copiez **tout** son contenu et collez-le dans l'éditeur Supabase.
5. Cliquez sur **Run** (ou Ctrl + Entrée). Le message **« Success. No rows returned »** doit apparaître.

✅ **Vérification :**
- **Table Editor** affiche les tables `materiel` et `profils`.
- **Storage** affiche un espace nommé `photos`.

> Le script peut être relancé sans danger : il ne supprime jamais de données.

---

## Étape 3 — Fermer les inscriptions (OBLIGATOIRE)

La clé publique de l'application est visible dans le code sur GitHub. Si les inscriptions restent ouvertes, **n'importe qui pourrait se créer un compte** et voir ou modifier l'inventaire. Il faut donc les fermer.

1. Menu de gauche : **Authentication**.
2. Ouvrez la rubrique des réglages généraux (**General configuration**, ou **Sign In / Providers** selon la version de Supabase).
3. **Désactivez** l'option **« Allow new users to sign up »**, puis cliquez sur **Save**.

À partir de là, seuls les comptes que vous créez vous-même (étape 4) peuvent se connecter.

---

## Étape 4 — Créer les comptes des 3 utilisateurs

1. **Authentication**, puis **Users**, puis **Add user** et **Create new user**.
2. Saisissez l'**email** et un **mot de passe** pour la personne.
3. Cochez **Auto Confirm User**, puis cliquez sur **Create user**.
4. Recommencez pour chacun des 3 utilisateurs.

Communiquez à chacun son email et son mot de passe. À la première connexion, chacun peut choisir le nom affiché dans l'application depuis **Outils**, rubrique **Votre compte**.

---

## Étape 5 — Relier l'application à Supabase

1. Dans Supabase, cliquez sur le bouton **Connect** en haut de la page du projet (ou ouvrez **Project Settings**, puis **Data API** / **API Keys**). Copiez :
   - la **Project URL**, qui ressemble à `https://abcdefghijkl.supabase.co` ;
   - la **clé publique**, appelée *anon public* ou *publishable*. Elle commence par `eyJ…` ou `sb_publishable_…`.
   > ⛔ Ne copiez **jamais** la clé *service_role* ni la clé *secret*. Elles donnent tous les droits et ne doivent jamais se retrouver sur GitHub.
2. Sur GitHub, dans votre dépôt, cliquez sur le fichier **`config.js`**, puis sur le **crayon** ✏️ (Edit).
3. Collez les deux valeurs **entre les guillemets** :
   ```js
   SUPABASE_URL: "https://abcdefghijkl.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...votre-cle...",
   ```
4. Cliquez sur **Commit changes**.
5. Attendez 1 minute, puis rechargez l'application sur le téléphone (deux fois si besoin).

✅ **Vérification :** l'écran de **connexion** apparaît. Connectez-vous avec un des comptes de l'étape 4. En haut de l'écran, la mention **« En direct »** doit s'afficher avec un point vert.

**Test du temps réel :** ouvrez l'application sur deux téléphones et ajoutez une fiche sur l'un. Elle apparaît aussitôt sur l'autre.

---

## Étape 6 — Installer l'application sur les téléphones Android

Sur chaque téléphone :

1. Ouvrez **Chrome** et allez à l'adresse `https://VOTRE-NOM-GITHUB.github.io/inventaire/`.
2. Touchez le menu **⋮** en haut à droite, puis **« Ajouter à l'écran d'accueil »** ou **« Installer l'application »**.
3. L'icône **Inventaire** (courbes de niveau orange sur fond vert) apparaît sur l'écran d'accueil. L'application s'ouvre ensuite en plein écran, comme une vraie appli.

Astuce : envoyez l'adresse aux collègues par WhatsApp. Le bouton **Outils → Installer sur l'écran d'accueil** apparaît aussi quand Chrome le permet.

---

## Étape 7 (optionnelle) — Lecture des plaques signalétiques par IA

Cette étape ajoute le bouton **« Remplir depuis les photos »** : l'IA lit la plaque de l'appareil et propose la marque, le modèle et le numéro de série. Elle est **payante à l'usage** : de l'ordre d'un centime de dollar par fiche avec le modèle réglé par défaut (vérifiez les tarifs à jour sur le site d'Anthropic). L'application fonctionne très bien sans cette étape.

1. **Clé API** : sur **console.anthropic.com**, créez un compte, ajoutez un petit crédit dans **Billing**, puis ouvrez **API Keys** et **Create Key**. Copiez la clé (`sk-ant-…`).
2. **Secret Supabase** : dans Supabase, ouvrez **Edge Functions**, puis **Secrets**, puis **Add new secret** :
   - *Name* : `ANTHROPIC_API_KEY`
   - *Value* : la clé copiée
   - Cliquez sur **Save**.
3. **Fonction** : **Edge Functions**, puis **Deploy a new function**, puis **Via Editor**.
   - Nommez la fonction exactement `lire-plaque`.
   - Remplacez le code d'exemple par le contenu du fichier `lire-plaque.ts` (ouvrez-le avec le Bloc-notes).
   - Cliquez sur **Deploy function**. La fonction vérifie elle-même que la personne est connectée à l'application : personne d'autre ne peut consommer votre crédit.
4. **Activation** : sur GitHub, modifiez `config.js` et remplacez `IA_ACTIVE: false` par `IA_ACTIVE: true`, puis **Commit changes**.

✅ **Vérification :** dans le formulaire d'ajout, le bouton bleu **« Remplir depuis les photos »** apparaît. Photographiez une plaque et appuyez dessus. Les champs proposés s'affichent en bleu avec la mention « suggéré ».

> La clé API reste cachée dans Supabase. Elle n'apparaît jamais dans le code de l'application ni sur GitHub.

---

## Étape 8 — Importer l'ancien inventaire Excel (avec ses images)

1. Dans l'application : **Outils**, puis **Importer un fichier**, puis choisissez `Base de données matériel labo.xlsx`.
2. **Feuille** : les feuilles s'importent **une par une** (Balance, Moules Proctor + CBR, etc.).
3. Vérifiez la **ligne des titres** et la **correspondance des colonnes**. Elles sont détectées automatiquement et restent modifiables.
4. La **catégorie par défaut** est devinée d'après le nom de la feuille. Par exemple, « Balance » donne *Pesage / balances* et « Moules Proctor + CBR » donne *Essais de sols*.
5. Options conseillées, toutes cochées par défaut :
   - reprendre la désignation de la ligne du dessus quand elle est vide ;
   - copier les autres colonnes (portée, diamètre…) dans les remarques ;
   - ignorer les numéros de série déjà présents, pour éviter les doublons si on importe deux fois.
6. Contrôlez l'**aperçu**, puis appuyez sur **Importer**. À la fin, choisissez **« Importer une autre feuille »** pour continuer.

**Les images du fichier Excel sont importées** : une image posée dans une ligne (ou placée « dans la cellule » avec Excel 365) est ajoutée à la fiche de cette ligne, jusqu'à 3 par ligne (Appareil, Plaque, Autre vue, dans l'ordre des colonnes). L'écran de correspondance indique combien de photos ont été trouvées.

Toutes les fiches importées sont marquées **« À confirmer »**. Passez ensuite dans le labo avec le téléphone : sur chaque fiche, ajoutez les photos, corrigez si besoin, puis touchez **« Marquer comme vérifiée »**.

Règles appliquées automatiquement :
- **État** : « Bon » et « RAS » deviennent *Fonctionnel* ; « HS » et « Panne » deviennent *En panne* ; toute autre observation devient *À vérifier*, et le texte d'origine est conservé dans les remarques.
- **Lieu** : « Niamey-Siège » devient *Niamey – Laboratoire* avec l'emplacement *Siège* ; « Doutchi » reste *Doutchi* ; tout autre lieu devient *Autre*, et le texte d'origine est placé dans l'emplacement.
- **ID/Nombre** : un nombre devient la quantité ; un texte (`Bal05`, `PB001`…) devient l'identifiant (n° de série).

---

## Photos : export, sauvegarde et ajout en lot

Tout se trouve dans **Outils**, rubrique **Données** :

| Action | Résultat |
|---|---|
| **Exporter en Excel** | Un fichier `.xlsx` avec toutes les fiches et **une miniature de la photo sur chaque ligne**. |
| **Sauvegarde complète (.zip)** | Le fichier Excel **et toutes les photos en taille réelle** dans un dossier `photos`, nommées `GC-XXXXX_appareil.jpg`, `GC-XXXXX_plaque.jpg`, `GC-XXXXX_autre-vue.jpg`. Dans l'Excel, les liens « Voir la photo » ouvrent la photo (après avoir décompressé le dossier). À faire de préférence sur ordinateur. |
| **Importer un fichier** → choisir le `.zip` | **Restaure** une sauvegarde : fiches, identifiants et photos. Les fiches déjà présentes (même identifiant) sont ignorées : on peut restaurer sans créer de doublons. |
| **Associer des photos en lot** | Choisissez plusieurs photos : chacune rejoint la fiche dont l'**identifiant** (`GC-7K3PX.jpg`) ou le **n° de série** (`B425718362.jpg`) figure dans son nom. Ajoutez `plaque` ou `autre` dans le nom pour choisir la case (`GC-7K3PX_plaque.jpg`). |

Conseil : faites une **sauvegarde complète chaque mois** et gardez-la sur un disque ou dans le Drive de l'entreprise.

## Mettre à jour l'application plus tard

Pour remplacer un fichier (par exemple `app.css`) : dans le dépôt GitHub, **Add file**, puis **Upload files**, choisissez le nouveau fichier du même nom et cliquez sur **Commit changes**. Les téléphones reçoivent la nouvelle version à la prochaine ouverture, parfois après deux ouvertures.

---

## En cas de problème

| Problème | Solution |
|---|---|
| Page blanche ou erreur 404 | Vérifiez que Pages est activé (étape 1.6) et attendez 2 minutes. |
| Texte brut « Chargement de l'inventaire… » sans couleurs | Des fichiers manquent sur GitHub. Vérifiez que les **30 fichiers** sont bien dans le dépôt, puis rechargez avec **Ctrl + Maj + R**. |
| Toujours « Mode démo » après l'étape 5 | Vérifiez `config.js` : les valeurs doivent être **entre guillemets**, avec les virgules en fin de ligne. Rechargez deux fois. |
| « Email ou mot de passe incorrect » | Vérifiez que le compte existe dans **Authentication → Users** et qu'il a été créé avec **Auto Confirm User**. |
| « Accès refusé » | Le script SQL n'a pas été exécuté en entier : relancez-le (étape 2). |
| Les photos ne s'affichent pas | Vérifiez que l'espace `photos` existe dans **Storage**. Sinon, relancez le script SQL (`installation-supabase.sql`). |
| « Connexion… » reste affiché en haut | Le temps réel est coupé, mais l'application recharge quand même les données toutes les 30 secondes. Relancez le script SQL. |
| Projet Supabase « en pause » | Sur l'offre gratuite, un projet sans aucune activité pendant 7 jours est mis en pause. Ouvrez supabase.com, puis le projet, puis **Restore project**. Les données sont conservées. |
| Mot de passe oublié | Dans **SQL Editor**, lancez (en adaptant l'email et le nouveau mot de passe) :<br>`update auth.users set encrypted_password = extensions.crypt('NouveauMotDePasse', extensions.gen_salt('bf')) where email = 'personne@exemple.com';` |

---

## Limites de l'offre gratuite (Supabase)

- **Base de données : 500 Mo.** Largement suffisant : une fiche pèse quelques Ko.
- **Photos : 1 Go**, soit environ **3 000 photos**. Chaque photo est compressée dans le téléphone (environ 300 Ko).
- **Pause après 7 jours sans aucune activité** (voir le tableau ci-dessus).

## Contenu du dossier (30 fichiers, tous au même niveau)

| Fichier | Rôle |
|---|---|
| `index.html` | page de l'application |
| `config.js` | **le seul fichier à modifier** : adresse et clé Supabase, activation de l'IA |
| `app.js`, `data.js`, `importer.js`, `transfert.js`, `utils.js`, `images.js`, `icons.js` | fonctionnement de l'application |
| `app.css` | design |
| `manrope.woff2`, `instrument-serif.woff2`, `instrument-serif-italic.woff2`, `jetbrains-mono.woff2` | polices |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `contours.svg` | icônes et motif |
| `manifest.webmanifest`, `sw.js` | installation sur l'écran d'accueil |
| `supabase.js`, `xlsx.full.min.js`, `exceljs.min.js`, `jszip.min.js` | bibliothèques (Supabase, lecture et écriture des fichiers Excel avec images, archives .zip) |
| `installation-supabase.sql` | script de la base de données (étape 2) — n'a pas besoin d'être sur GitHub, mais peut y rester |
| `lire-plaque.ts` | fonction IA optionnelle (étape 7) |
| `GUIDE_INSTALLATION.md`, `README.md` | ce guide et la présentation |
