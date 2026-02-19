# YouTube Downloader (Node.js)

Un script Node.js pour télécharger des vidéos et de l'audio depuis YouTube.

## Caractéristiques

- ✅ **Installation automatique** - yt-dlp est téléchargé automatiquement au premier lancement
- ✅ **Support des playlists** - Télécharge automatiquement toutes les vidéos d'une playlist
- ✅ Téléchargement audio (MP3) avec choix de qualité
- ✅ Téléchargement vidéo (MP4) avec choix de qualité
- ✅ Affichage de la progression en temps réel
- ✅ ffmpeg inclus (pas d'installation manuelle)

## Prérequis

- **Node.js** >= 18.0.0

C'est tout ! Le binaire yt-dlp est téléchargé automatiquement au premier lancement.

## Installation

```bash
cd yt-downloader
npm install
```

## Utilisation

### Télécharger une vidéo

```bash
node index.js "https://www.youtube.com/watch?v=VIDEO_ID"
```

### Télécharger une playlist complète

```bash
node index.js "https://www.youtube.com/playlist?list=PLAYLIST_ID"
```

### Utiliser un fichier de liens

Créez un fichier `links.txt` avec une URL par ligne :

```
https://www.youtube.com/watch?v=VIDEO_ID_1
https://www.youtube.com/watch?v=VIDEO_ID_2
# Ceci est un commentaire (lignes commençant par # sont ignorées)
https://www.youtube.com/playlist?list=PLAYLIST_ID
```

Puis lancez :

```bash
node index.js
```

## Options interactives

Le script vous demandera :

1. **Type de média** : Audio (0) ou Vidéo (1)
2. **Qualité** :
   - Audio : 128, 192, 256, 320 kbps
   - Vidéo : 720p, 1080p, ou meilleure qualité disponible
3. **Dossier de destination** : Par défaut `./downloads` (ou `./downloads/{nom_playlist}` pour les playlists)

## Structure des fichiers

```
yt-downloader/
├── index.js        # Script principal
├── package.json    # Configuration npm
├── bin/            # Binaire yt-dlp (téléchargé automatiquement)
├── links.txt       # (optionnel) Liste de liens YouTube
├── downloads/      # Dossier de téléchargement par défaut
└── README.md       # Ce fichier
```

## Dépendances

| Package | Description |
|---------|-------------|
| `yt-dlp-wrap` | Wrapper Node.js pour yt-dlp avec téléchargement auto |
| `ffmpeg-static` | Binaire ffmpeg inclus automatiquement |
| `fluent-ffmpeg` | API fluide pour ffmpeg |

## Licence

MIT
