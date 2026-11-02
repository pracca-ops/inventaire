# Guide d'installation et de mise à jour — Inventaire GéoConsulting

Application web d'inventaire du matériel, utilisable sur téléphone (Android) et sur ordinateur.

- **Hébergement de l'application** : GitHub Pages (gratuit)
- **Base de données, comptes et photos** : Supabase (gratuit)

Version décrite : **1.2.0**. La version installée s'affiche dans **Outils**, rubrique **Application**.

> Les 30 fichiers de l'application sont **tous au même niveau, sans sous-dossier** : on les sélectionne tous et on les envoie en une fois sur GitHub.

---

## Sommaire

1. Mettre l'application en ligne (GitHub Pages)
2. Créer la base de données (Supabase)
3. Fermer les inscriptions (obligatoire)
4. Créer les comptes
5. Relier l'application à Supabase (`config.js`)
6. Installer sur les téléphones
7. Lecture des plaques par IA (optionnelle)
8. Importer l'ancien inventaire
9. Photos : export, sauvegarde, ajout en lot
10. **Mettre à jour l'application** (passage à une nouvelle version)
11. En cas de problème

---

## 1. Mettre l'application en ligne avec GitHub Pages

1. Sur **github.com**, cliquez sur **+** puis **New repository**. Donnez un nom (par exemple `inventaire`), cochez **Public**, puis **Create repository**.
   Le code est visible, mais **aucune donnée** ne s'y trouve : les fiches restent protégées dans Supabase.
2. Cliquez sur **uploading an existing file** (ou **Add file**, puis **Upload files**).
3. Cliquez sur **choose your files**, ouvrez le dossier `inventaire-geoconsulting`, appuyez sur **Ctrl + A** pour sélectionner **les 30 fichiers**, puis cliquez sur **Ouvrir**.
4. Attendez que la liste soit complète, puis cliquez sur **Commit changes**.
5. Ouvrez **Settings**, puis **Pages**. Dans *Source*, choisissez **Deploy from a branch**, puis **main** et **/ (root)**, et cliquez sur **Save**.
6. Après 1 à 2 minutes, l'adresse s'affiche en haut de la page : `https://VOTRE-NOM.github.io/inventaire/`.

✅ L'application s'ouvre avec la mention **« Mode démo »**.

## 2. Créer la base de données Supabase

1. Sur **supabase.com**, cliquez sur **New project** et remplissez :
   - *Name* : `inventaire-geoconsulting`
   - *Database Password* : cliquez sur **Generate a password** et notez-le
   - *Region* : **West EU (Paris)**
2. Ouvrez **SQL Editor**, collez **tout** le contenu de `installation-supabase.sql`, puis cliquez sur **Run**. Le message **« Success. No rows returned »** doit s'afficher.

✅ **Table Editor** affiche les tables `materiel` et `profils`, et **Storage** affiche un espace `photos`.

## 3. Fermer les inscriptions (OBLIGATOIRE)

Allez dans **Authentication**, ouvrez les réglages (**General configuration** ou **Sign In / Providers**), **désactivez « Allow new users to sign up »**, puis cliquez sur **Save**.

Sans cela, n'importe qui pourrait se créer un compte avec la clé publique, qui est visible sur GitHub.

## 4. Créer les comptes

Ouvrez **Authentication**, puis **Users**, puis **Add user** et **Create new user**. Saisissez l'email et le mot de passe, cochez **Auto Confirm User**, puis cliquez sur **Create user**. Recommencez pour chaque personne.

## 5. Relier l'application à Supabase

1. Dans Supabase, cliquez sur le bouton **Connect** et copiez :
   - la **Project URL** (`https://xxxx.supabase.co`) ;
   - la clé **publishable** (`sb_publishable_…`) ou **anon** (`eyJ…`).

   ⛔ Ne copiez jamais la clé *secret* ni la clé *service_role*.
2. Sur GitHub, ouvrez `config.js`, cliquez sur le crayon ✏️, puis collez les deux valeurs **entre les guillemets** :
   ```js
   SUPABASE_URL: "https://xxxx.supabase.co",
   SUPABASE_ANON_KEY: "sb_publishable_xxxxxxxx",
   ```
3. Cliquez sur **Commit changes**, attendez 1 minute, puis rechargez la page avec **Ctrl + Maj + R**.

✅ L'écran de connexion s'affiche. Une fois connecté, la mention **« En direct »** apparaît avec un point vert.

## 6. Installer sur les téléphones

Dans **Chrome**, ouvrez l'adresse de l'application, puis le menu **⋮** et **« Ajouter à l'écran d'accueil »** (ou « Installer l'application »).

## 7. Lecture des plaques par IA (optionnelle, payante à l'usage)

1. Sur **console.anthropic.com**, ajoutez un crédit, puis créez une clé API (`sk-ant-…`).
2. Dans Supabase, ouvrez **Edge Functions**, puis **Secrets**, et ajoutez `ANTHROPIC_API_KEY` avec la clé comme valeur.
3. Ouvrez **Edge Functions**, puis **Deploy a new function** et **Via Editor**. Nommez la fonction `lire-plaque`, collez le contenu de `lire-plaque.ts`, puis cliquez sur **Deploy**. La fonction vérifie elle-même que l'utilisateur est connecté.
4. Dans `config.js` sur GitHub, mettez `IA_ACTIVE: true`.

## 8. Importer l'ancien inventaire

Allez dans **Outils**, puis **Importer un fichier**. Le fichier peut être un Excel (`.xlsx` ou `.xls`), un CSV ou une sauvegarde `.zip`.

- Les feuilles s'importent **une par une**. Les colonnes sont reconnues automatiquement, et vous pouvez les corriger.
- **Les images du fichier Excel sont importées** : une image placée dans une ligne rejoint la fiche de cette ligne (3 au maximum, dans l'ordre Appareil, Plaque, Autre vue).
- **Catégories** :
  - une catégorie de la liste est reprise telle quelle ;
  - un nom proche est rattaché à la catégorie correspondante (par exemple « balances » devient *Pesage / balances*) ;
  - sinon, le texte du fichier est conservé comme **catégorie libre**.
- Toutes les fiches importées sont marquées **« À confirmer »**.
- Règles automatiques :
  - « Bon » et « RAS » deviennent *Fonctionnel* ; « HS » et « Panne » deviennent *En panne* ;
  - « Niamey-Siège » devient *Niamey – Laboratoire*, avec l'emplacement *Siège* ;
  - dans la colonne « ID/Nombre », un nombre devient une quantité et un texte devient un identifiant.

## 9. Photos : export, sauvegarde, ajout en lot

Tout se trouve dans **Outils**, rubrique **Données** :

| Action | Résultat |
|---|---|
| **Exporter en Excel** | Un fichier `.xlsx` avec toutes les fiches et **une miniature de la photo par ligne**. |
| **Sauvegarde complète (.zip)** | L'Excel **et toutes les photos en taille réelle**, nommées `GC-XXXXX_appareil.jpg`, `_plaque.jpg` et `_autre-vue.jpg`. Les liens « Voir la photo » de l'Excel ouvrent les photos une fois le dossier décompressé. À faire de préférence sur ordinateur. |
| **Importer** un `.zip` de sauvegarde | Restaure les fiches, leurs identifiants et leurs photos. Les fiches déjà présentes (même identifiant) sont ignorées, donc il n'y a pas de doublons. |
| **Associer des photos en lot** | Chaque photo rejoint la fiche dont l'**identifiant** (`GC-7K3PX.jpg`) ou le **n° de série** (`B425718362.jpg`) figure dans son nom. Ajoutez `plaque` ou `autre` au nom pour choisir la case. |

Conseil : faites **une sauvegarde complète chaque mois**.

### Compatibilité des anciens exports

La version 1.2 relit **tous les exports des versions précédentes**, avec les mêmes identifiants, dates, états, sites, catégories et remarques sur plusieurs lignes :

| Export | Relu par la version 1.2 ? |
|---|---|
| CSV de la version 1.0 (`inventaire-geoconsulting-AAAA-MM-JJ.csv`) | ✅ Oui. Les dates jj/mm/aaaa restent correctes et les n° de série commençant par 0 sont conservés. Ce format ne contenait pas les photos. |
| Le même CSV, ouvert puis réenregistré dans Excel | ✅ Oui, les accents sont conservés. |
| Excel (`.xlsx`) de la version 1.1 | ✅ Oui. Les miniatures deviennent la photo « Appareil » si la fiche n'existe plus. |
| Sauvegarde `.zip` de la version 1.1 | ✅ Oui, avec toutes les photos en taille réelle. |

Pour restaurer, allez dans **Outils**, puis **Importer un fichier**, et choisissez l'export. Les fiches encore présentes ne sont pas recréées.

---

## 10. Mettre à jour l'application (passage à une nouvelle version)

Une mise à jour remplace les fichiers de l'application sur GitHub. **Les fiches, les comptes et les photos ne sont pas touchés** : ils sont dans Supabase.

### Étape A — GitHub

1. Décompressez le dossier de mise à jour reçu (par exemple `mise-a-jour-v1.2`). Il ne contient **pas** de `config.js`.
2. Sur GitHub, dans votre dépôt, cliquez sur **Add file**, puis **Upload files**, puis **choose your files**.
3. Dans le dossier de mise à jour, appuyez sur **Ctrl + A** pour tout sélectionner, puis cliquez sur **Ouvrir**. Les fichiers de même nom sont remplacés.
4. Cliquez sur **Commit changes**.
5. Attendez 1 à 2 minutes, ouvrez l'application sur ordinateur, puis appuyez sur **Ctrl + Maj + R**.
6. Vérifiez : dans **Outils**, rubrique **Application**, la **Version** doit afficher le nouveau numéro.
7. Sur les téléphones : fermez complètement l'application, puis rouvrez-la. Si l'ancienne version s'affiche encore, recommencez une deuxième fois.

> ⚠️ **Ne remplacez jamais votre `config.js`** par celui d'un téléchargement : il contient l'adresse et la clé de **votre** projet Supabase. Si l'application affiche **« Mode démo »** après une mise à jour, c'est que `config.js` a été écrasé : refaites l'étape 5.

### Étape B — Supabase

Seulement si les notes de la version le demandent : ouvrez **SQL Editor**, collez le script fourni, puis cliquez sur **Run**. Le script d'installation peut être relancé sans danger, car il ne supprime aucune donnée.

**Version 1.2 : aucun changement dans Supabase.** La catégorie libre est enregistrée dans la colonne `categorie`, qui accepte déjà n'importe quel texte.

### Notes de version

- **1.2.0**
  - Catégorie **« Autre » avec saisie libre** : les catégories déjà saisies sont proposées, et les filtres de la liste les affichent.
  - Relecture des exports CSV de la version 1.0, y compris s'ils ont été réenregistrés dans Excel.
  - Retours à la ligne conservés dans les remarques importées.
  - Après une modification, le bouton Retour ramène directement à la liste.
- **1.1.0**
  - Images de l'Excel importées avec leur fiche.
  - Export Excel avec miniatures et sauvegarde `.zip` avec toutes les photos.
  - Association de photos en lot.
- **1.0.0** : première version.

---

## 11. En cas de problème

| Problème | Solution |
|---|---|
| Page blanche ou erreur 404 | Vérifiez que GitHub Pages est activé (étape 1.5) et attendez 2 minutes. |
| Texte brut « Chargement de l'inventaire… » sans couleurs | Des fichiers manquent sur GitHub : vérifiez que les **30 fichiers** sont présents, puis rechargez avec **Ctrl + Maj + R**. |
| « Mode démo » au lieu de l'écran de connexion | `config.js` est vide ou a été écrasé : refaites l'étape 5. |
| « Email ou mot de passe incorrect » | Vérifiez que le compte existe dans **Authentication → Users** et qu'il a été créé avec **Auto Confirm User**. |
| « Accès refusé » | Relancez `installation-supabase.sql` (étape 2). |
| La nouvelle version n'apparaît pas | **Ctrl + Maj + R** sur ordinateur. Sur téléphone, fermez puis rouvrez l'application, deux fois si besoin. |
| Projet Supabase « en pause » | Un projet gratuit est mis en pause après 7 jours sans activité. Ouvrez-le sur supabase.com, puis cliquez sur **Restore project**. |
| Mot de passe oublié | Dans **SQL Editor** :<br>`update auth.users set encrypted_password = extensions.crypt('NouveauMotDePasse', extensions.gen_salt('bf')) where email = 'personne@exemple.com';` |

## Contenu du dossier (30 fichiers, tous au même niveau)

| Fichier | Rôle |
|---|---|
| `index.html` | page de l'application |
| `config.js` | **votre configuration** : adresse et clé Supabase, IA. À ne pas écraser lors d'une mise à jour. |
| `app.js`, `data.js`, `importer.js`, `transfert.js`, `utils.js`, `images.js`, `icons.js` | fonctionnement de l'application |
| `app.css` | design |
| `manrope.woff2`, `instrument-serif.woff2`, `instrument-serif-italic.woff2`, `jetbrains-mono.woff2` | polices |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `contours.svg` | icônes et motif |
| `manifest.webmanifest`, `sw.js` | installation sur l'écran d'accueil et mises à jour |
| `supabase.js`, `xlsx.full.min.js`, `exceljs.min.js`, `jszip.min.js` | bibliothèques |
| `installation-supabase.sql` | script de la base de données |
| `lire-plaque.ts` | fonction IA (optionnelle) |
| `GUIDE_INSTALLATION.md`, `README.md` | ce guide et la présentation |
