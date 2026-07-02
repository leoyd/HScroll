# Table Horizontal Scroll Helper

Extension Chrome Manifest V3 qui ajoute des contrôles visuels de scroll horizontal aux tableaux et conteneurs scrollables.

## Fonctionnalités

- Détection automatique des tableaux et conteneurs avec débordement horizontal.
- Ombres latérales cliquables pour scroller sans viser précisément la barre de scroll.
- Bouton rond avec effet glass design.
- Gestion des colonnes `sticky` / `fixed` sans dépendre uniquement des classes CSS métier.
- Rognage vertical pour éviter de passer au-dessus des éléments fixes ou sticky visibles dans la page.
- Badge d'extension indiquant le nombre de zones détectées sur l'onglet courant.

## Installation locale

1. Télécharger ou cloner le projet.
2. Ouvrir `chrome://extensions`.
3. Activer le mode développeur.
4. Cliquer sur **Charger l'extension non empaquetée**.
5. Sélectionner le dossier du projet.

## Structure

```text
manifest.json   Configuration Chrome Manifest V3
content.js      Détection des zones scrollables et placement des overlays
styles.css      Rendu des ombres, du bouton et de l'animation
background.js   Mise à jour du badge Chrome
LICENSE         Licence MIT
```

## Publication

Le projet est publié sous licence MIT. Tu peux le modifier, le distribuer et le publier, en conservant le fichier `LICENSE`.
