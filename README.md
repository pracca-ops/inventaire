# Inventaire GéoConsulting

Application web d'inventaire du matériel du laboratoire de GéoConsulting Sarl (Niamey et Doutchi). Version 1.3.0.

- Fiches avec photos (appareil, plaque signalétique, autre vue), état, site, étalonnage, remarques
- Catégories et sites de la liste, ou saisie libre avec l'option « Autre »
- Tableau de bord : total, à vérifier, pannes et réparations, étalonnages échus ou à moins de 30 jours
- Mise à jour en temps réel entre les téléphones de l'équipe
- Import de l'ancien inventaire Excel **avec ses images**, CSV ou sauvegarde .zip (exports des versions 1.0 et 1.1 compris)
- Export Excel avec une miniature par ligne, sauvegarde complète .zip (Excel + toutes les photos)
- Association de photos en lot d'après le nom du fichier (identifiant ou n° de série)
- Lecture des plaques par IA (optionnelle)
- Thème clair et sombre, installable sur l'écran d'accueil Android

**Technique :** HTML, CSS et JavaScript sans compilation, tous les fichiers au même niveau (aucun sous-dossier), hébergés sur GitHub Pages ; base de données, comptes et photos sur Supabase.

➡️ **Installation et mises à jour pas à pas : voir [GUIDE_INSTALLATION.md](GUIDE_INSTALLATION.md).**
