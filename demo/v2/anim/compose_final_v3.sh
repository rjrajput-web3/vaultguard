#!/bin/bash
# VAULTRY v3 final compose — cinematic premium upgrade
# - S1/S7 re-rendered: cinematic_bg + 3D shield tilt
# - S3/S6: glass dashboard (frosted-glass, same real content)
# - S2/S4/S5: kept, cinematic push-in via zoompan on ALL scenes
# - Audio: v3 mix (locked VO fit to 140.416s + user's music at -20dB + SFX)
# - Captions: same timings, cap1 corrected to $18.4M
# 1920x1080@30fps H.264 + AAC, total ~140.4s
set -e
cd ~/workspace/vaultguard/demo/v2
mkdir -p build/final
V2=/home/hatch/workspace/vaultguard/demo/v2
S4RAW=$(ls raw/s4/*.webm | head -1)
ZP="fps=30,format=yuv420p"

# ---- 1) Scene trims + cinematic push-in (1.00 -> ~1.035) ----
# c1: 473f, c2: 672f, c3: 564f, c4: 575f, c5: 877f, c6: 634f, c7: 491f
ffmpeg -y -v error -i build/s1.mp4 -t 15.76 -vf "zoompan=z='1+0.035*on/473':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c1.mp4
ffmpeg -y -v error -i build/s2.mp4 -t 22.39 -vf "zoompan=z='1+0.03*on/672':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c2.mp4
ffmpeg -y -v error -i build/s3.mp4 -t 18.80 -vf "zoompan=z='1+0.03*on/564':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c3.mp4
# S4: crop stale nav bar, scale back, push-in
ffmpeg -y -v error -ss 28 -i "$S4RAW" -t 19.16 -vf "fps=30,crop=1920:1004:0:76,scale=1920:1080,zoompan=z='1+0.03*on/575':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c4.mp4
ffmpeg -y -v error -i build/s5.mp4 -t 29.22 -vf "zoompan=z='1+0.035*on/877':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c5.mp4
ffmpeg -y -v error -i build/s6.mp4 -t 21.13 -vf "zoompan=z='1+0.03*on/634':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c6.mp4
# S7: push-in (1.00 -> 1.05)
ffmpeg -y -v error -i build/s7.mp4 -t 16.37 -vf "zoompan=z='1+0.05*on/491':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c7.mp4
echo "trims done"

# ---- 2) xfade chain (0.4s each, same offsets) ----
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
 -map "[xv]" -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/final/v3_nocap.mp4
echo "video assembled"

# ---- 3) Lower-third captions (same timings, cap1 = $18.4M corrected) ----
FF=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
CAP=$V2/captions
ffmpeg -y -v error -i build/final/v3_nocap.mp4 -vf "\
drawtext=fontfile=$FF:textfile=$CAP/cap1.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,1.5,14.5)',\
drawtext=fontfile=$FF:textfile=$CAP/cap2.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,17,36)',\
drawtext=fontfile=$FF:textfile=$CAP/cap3.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,39,54)',\
drawtext=fontfile=$FF:textfile=$CAP/cap4.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,57.5,73)',\
drawtext=fontfile=$FF:textfile=$CAP/cap5.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,76.5,102)',\
drawtext=fontfile=$FF:textfile=$CAP/cap6.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,105,122.5)',\
drawtext=fontfile=$FF:textfile=$CAP/cap7.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,126,139)'" \
 -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/final/v3.mp4
echo "captions done"

# ---- 4) Mux with v3 audio mix ----
ffmpeg -y -v error -i build/final/v3.mp4 -i build/v3_mix.aac \
 -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart vaultguard-final.mp4
echo "=== DONE ==="
ffprobe -v error -show_entries stream=width,height,r_frame_rate,codec_name -show_entries format=duration,size -of default=noprint_wrappers=1 vaultguard-final.mp4
