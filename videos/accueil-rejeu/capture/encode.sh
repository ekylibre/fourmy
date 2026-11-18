#!/bin/sh
# Boucle sans saut : la dernière seconde se fond dans la première, puis WebM (VP9), MP4 (H.264) et affiche.
#   capture/encode.sh <sortie> <affiche> : images de assets/raw/<sortie>, vidéos apps/site/public/videos/<sortie>.webm et .mp4,
#   affiche apps/site/src/assets/captures/<affiche>.png (par défaut : accueil-pulverisation, accueil-3d).
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-accueil-pulverisation}
poster=${2:-accueil-3d}
raw=$here/assets/raw/$out
site=$here/../../apps/site
fps=30; fade=30
n=$(ls "$raw" | wc -l)
main=$((n - fade))
offset=$(python3 -c "print(($main - $fade) / $fps)")
mkdir -p "$site/public/videos"
graph="[0:v]trim=start_frame=$fade,setpts=PTS-STARTPTS[a];[1:v]trim=end_frame=$fade,setpts=PTS-STARTPTS[b];[a][b]xfade=transition=fade:duration=$(python3 -c "print($fade/$fps)"):offset=$offset,scale=1600:900:flags=lanczos,format=yuv420p[v]"
in="-framerate $fps -i $raw/f%05d.jpg"
ffmpeg -y -loglevel error $in $in -filter_complex "$graph" -map "[v]" -an -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -deadline good -cpu-used 2 "$site/public/videos/$out.webm"
ffmpeg -y -loglevel error $in $in -filter_complex "$graph" -map "[v]" -an -c:v libx264 -crf 28 -preset slow -profile:v high -movflags +faststart "$site/public/videos/$out.mp4"
# Affiche : la première image de la boucle (image n° $fade des images brutes).
ffmpeg -y -loglevel error -i "$raw/f$(printf %05d $fade).jpg" -vf scale=1600:900:flags=lanczos "$site/src/assets/captures/$poster.png"
ls -l "$site/public/videos"
