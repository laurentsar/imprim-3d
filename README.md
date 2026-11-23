# Imprim 3D

Appli Android (Capacitor) + PWA : trouver un modèle 3D, le voir, le trancher
**dans le téléphone** pour une Creality Ender 3, puis l'envoyer à OctoPrint.

## Sources
| Source | Parcourir / chercher | Télécharger |
|---|---|---|
| Printables | ✅ sans compte (GraphQL public) | ✅ (`getDownloadLink`) |
| Thingiverse | ✅ avec un **App Token** (⚙️ Réglages) | ✅ |
| MakerWorld | ✅ sans compte | ❌ compte Bambu exigé → ouverture du site, puis *Partager → Imprim 3D* |
| Lien collé / partagé (🔗 dans Modèles ou Mes fichiers) | page Printables / Thingiverse / MakerWorld, ou lien vers un `.stl` / `.3mf` (direct, Dropbox, Google Drive, GitHub, lien sans extension : format détecté sur le contenu) | |

Fichiers acceptés : STL (binaire/ASCII) et 3MF (objets, composants, fichiers
d'objets séparés Bambu/Prusa, transformations). Un 3MF à plusieurs objets
propose « Tous » ou un objet seul.

## Tranchage
CuraEngine compilé en WebAssembly (`cura-wasm` 1.5.2, vendoré dans
`www/vendor/cura-wasm.es.js`) + définition `creality_ender3` extraite de
`cura-wasm-definitions` (`www/vendor/ender3.def.json`).

⚠️ **Deux pièges vérifiés** (voir `www/slicer-settings.js`) :
1. CuraEngine en ligne de commande **n'évalue pas les formules** des
   définitions Cura : changer `infill_sparse_density` seul ne change rien. Tous
   les réglages dérivés sont calculés dans `curaSettings()`.
2. Les réglages « maille » (remplissage, parois, supports) doivent aussi être
   passés à l'extrudeur (`-e0`), et **`-e0` reste actif pour les `-s` qui
   suivent** : tous les globaux d'abord, puis tous les `-e0`.

La pièce est centrée en X/Y et posée sur Z=0 avant tranchage (`mesh.prepare`) :
CuraEngine place l'origine du maillage au centre du plateau.

## OctoPrint
Adresse par défaut `http://192.168.1.91:5000`. Clé API : bouton **Demander
une clé** (plugin Application Keys, à accepter dans l'interface OctoPrint) ou
collée à la main. Envoi `POST /api/files/local` (multipart, `print=true` pour
lancer). En APK, fetch passe par CapacitorHttp : HTTP en clair autorisé
(`network_security_config.xml`), pas de CORS.

## Build
APK construit et publié par GitHub Actions à chaque push sur `master`
(clé de signature en secrets `ANDROID_KEYSTORE_B64` / `ANDROID_KEYSTORE_PASSWORD`,
clé locale dans `~/app-kit/keys/imprim-3d.*`). Version : `package.json`,
`www/version.json`, `window.APP_VERSION` (index.html), `versionName`/`versionCode`
(android/app/build.gradle), `CACHE` (www/sw.js).

Icônes : `python3 tools_gen_icon.py --android`.
