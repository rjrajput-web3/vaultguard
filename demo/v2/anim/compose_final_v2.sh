#!/bin/bash
# VAULTRY v2 final compose v2 — premium polish pass
# Fixes: S3 re-rendered (real quote text + vaultry title), S6 re-rendered
# (vaultry title + wrapped text, no overflow), S4 top-crop (stale nav logo),
# S7 subtle push-in, lower-third captions synced to VO.
# 1920x1080@30fps H.264 + AAC, total 140.36s
set -e
cd ~/workspace/vaultguard/demo/v2
mkdir -p build/final
V2=/home/hatch/workspace/vaultguard/demo/v2
S4RAW=$(ls raw/s4/*.webm | head -1)

# ---- 1) Scene trims (same target durations as v1) ----
ffmpeg -y -v error -i build/s1.mp4 -t 15.76 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 build/final/c1.mp4
ffmpeg -y -v error -i build/s2.mp4 -t 22.39 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 build/final/c2.mp4
cp build/s3.mp4 build/final/c3.mp4
# S4: crop off the stale VAULTGUARD nav bar (top 76px), then scale back to 1080p
ffmpeg -y -v error -ss 28 -i "$S4RAW" -t 19.16 -vf "fps=30,crop=1920:1004:0:76,scale=1920:1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c4.mp4
ffmpeg -y -v error -i build/s5.mp4 -t 29.22 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 build/final/c5.mp4
cp build/s6.mp4 build/final/c6.mp4
# S7: gentle cinematic push-in (1.00 -> 1.05) for logo-reveal depth
ffmpeg -y -v error -i build/s7.mp4 -t 16.37 -vf "zoompan=z='1+0.05*on/491':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c7.mp4
echo "trims done"

# ---- 2) xfade chain (0.4s each, same offsets as v1) ----
ffmpeg -y -v error \
 -i build/final/c1.mp4 -i build/final/c2.mp4 -i build/final/c3.mp4 -i build/final/c4.mp4 \
 -i build/final/c5.mp4 -i build/final/c6.mp4 -i build/final/c7.mp4 \
 -filter_complex "\
[0][1]xfade=transition=fade:duration=0.4:offset=15.36[x1];\
[x1][2]xfade=transition=fade:duration=0.4:offset=37.35[x2];\
[x2][3]xfade=transition=fade:duration=0.4:offset=55.75[x3];\
[x3][4]xfade=transition=fade:duration=0.4:offset=74.51[x4];\
[x4][5]xfade=transition=fade:duration=0.4:offset=103.33[x5];\
[x5][6]xfade=transition=fade:duration=0.4:offset=124.08,fade=t=in:st=0:d=0.5,fade=t=out:st=139.86:d=0.5[xv]" \
 -map "[xv]" -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/final/video_nocap.mp4
echo "video assembled"

# ---- 3) Lower-third captions, synced to VO scenes (minimal, bottom, translucent) ----
FF=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
ffmpeg -y -v error -i build/final/video_nocap.mp4 -vf "\
drawtext=fontfile=$FF:textfile=/tmp/vgcap/cap1.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,1.5,14.5)',\
drawtext=fontfile=$FF:textfile=/tmp/vgcap/cap2.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,17,36)',\
drawtext=fontfile=$FF:textfile=/tmp/vgcap/cap3.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,39,54)',\
drawtext=fontfile=$FF:textfile=/tmp/vgcap/cap4.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,57.5,73)',\
drawtext=fontfile=$FF:textfile=/tmp/vgcap/cap5.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,76.5,102)',\
drawtext=fontfile=$FF:textfile=/tmp/vgcap/cap6.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,105,122.5)',\
drawtext=fontfile=$FF:textfile=/tmp/vgcap/cap7.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,126,139)'" \
 -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/final/video.mp4
echo "captions done"

# ---- 4) Mux with existing audio mix (unchanged VO + bed) ----
ffmpeg -y -v error -i build/final/video.mp4 -i build/final/mix.aac \
 -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart vaultguard-final.mp4
echo "=== DONE ==="
ffprobe -v error -show_entries stream=width,height,r_frame_rate,codec_name -show_entries format=duration,size -of default=noprint_wrappers=1 vaultguard-final.mp4
