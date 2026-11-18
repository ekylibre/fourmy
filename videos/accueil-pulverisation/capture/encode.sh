#!/bin/sh
# Boucle sans saut : la dernière seconde se fond dans la première, puis WebM (VP9), MP4 (H.264) et affiche.
#   capture/encode.sh [dossier d'images] ; sorties dans apps/site/public/videos et l'affiche dans les captures du site.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
raw=${1:-$here/assets/raw/boucle}
site=$here/../../apps/site
fps=30; fade=30
n=$(ls "$raw" | wc -l)
main=$((n - fade))
offset=$(python3 -c "print(($main - $fade) / $fps)")
mkdir -p "$site/public/videos"
graph="[0:v]trim=start_frame=$fade,setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=$fade,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=$(python3 -c "print($fade/$fps)"):offset=$offset,scale=1600:900:flags=lanczos,format=yuv420p[v]"
in="-framerate $fps -i $raw/f%05d.jpg"
ffmpeg -y -loglevel error $in $in -filter_complex "$graph" -map "[v]" -an -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -deadline good -cpu-used 2 "$site/public/videos/accueil-pulverisation.webm"
ffmpeg -y -loglevel error $in $in -filter_complex "$graph" -map "[v]" -an -c:v libx264 -crf 28 -preset slow -profile:v high -movflags +faststart "$site/public/videos/accueil-pulverisation.mp4"
# Affiche : la première image de la boucle (image n° $fade des images brutes).
ffmpeg -y -loglevel error -i "$raw/f$(printf %05d $fade).jpg" -vf scale=1600:900:flags=lanczos "$site/src/assets/captures/accueil-3d.png"
ls -l "$site/public/videos"
