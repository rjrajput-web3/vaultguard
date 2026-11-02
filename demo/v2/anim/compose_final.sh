#!/bin/bash
# VAULTGUARD v2 final compose — 1920x1080@30fps H.264 + AAC
# Scenes trimmed to real VO durations; 0.4s xfade transitions (no blank frames).
set -e
cd ~/workspace/vaultguard/demo/v2
mkdir -p build/final
V2=/home/hatch/workspace/vaultguard/demo/v2

# ---- 1) Trim scenes to target durations (video = VO_real + 0.4 overlap) ----
# S1: 17.94 -> 15.76 | S2: 26.03 -> 22.39 | S3: 18.80 (as rendered)
# S4: raw 58.16 -> cut t=28..47.16 (19.16s) | S5: 35.78 -> 29.22 | S6: 21.15 | S7: 19.51 -> 16.28
ffmpeg -y -v error -i build/s1.mp4 -t 15.76 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 build/final/c1.mp4
ffmpeg -y -v error -i build/s2.mp4 -t 22.39 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 build/final/c2.mp4
cp build/s3.mp4 build/final/c3.mp4
S4RAW=$(ls raw/s4/*.webm | head -1)
ffmpeg -y -v error -ss 28 -i "$S4RAW" -t 19.16 -vf "fps=30,scale=1920:1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 -r 30 build/final/c4.mp4
ffmpeg -y -v error -i build/s5.mp4 -t 29.22 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 build/final/c5.mp4
cp build/s6.mp4 build/final/c6.mp4
ffmpeg -y -v error -i build/s7.mp4 -t 16.37 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 build/final/c7.mp4
echo "trims done"

# ---- 2) xfade chain (0.4s each) ----
# offsets: c1 15.76 -> o1=15.36; c2 22.39 -> o2=15.36+22.39-0.4=37.35
# o3=37.35+18.80-0.4=55.75; o4=55.75+19.16-0.4=74.51; o5=74.51+29.22-0.4=103.33
# o6=103.33+21.15-0.4=124.08; total=124.08+16.28=140.36
ffmpeg -y -v error \
 -i build/final/c1.mp4 -i build/final/c2.mp4 -i build/final/c3.mp4 -i build/final/c4.mp4 \
 -i build/final/c5.mp4 -i build/final/c6.mp4 -i build/final/c7.mp4 \
 -filter_complex "\
[0][1]xfade=transition=fade:duration=0.4:offset=15.36[x1];\
[x1][2]xfade=transition=fade:duration=0.4:offset=37.35[x2];\
[x2][3]xfade=transition=fade:duration=0.4:offset=55.75[x3];\
[x3][4]xfade=transition=fade:duration=0.4:offset=74.51[x4];\
[x4][5]xfade=transition=fade:duration=0.4:offset=103.33[x5];\
[x5][6]xfade=transition=fade:duration=0.4:offset=124.08,fade=t=in:st=0:d=0.5,fade=t=out:st=139.86:d=0.5[v]" \
 -map "[v]" -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/final/video.mp4
echo "video assembled"

# ---- 3) Audio: VO segments at scene starts + bed (-20dB) ----
# VO starts: 0, 15.36, 37.35, 55.75, 74.51, 103.33, 124.08
ffmpeg -y -v error \
 -i vo_clean/s1.mp3 -i vo_clean/s2.mp3 -i vo_clean/s3.mp3 -i vo_clean/s4.mp3 \
 -i vo_clean/s5.mp3 -i vo_clean/s6.mp3 -i vo_clean/s7.mp3 \
 -i /home/hatch/workspace/hampi-film/audio/bed.wav \
 -filter_complex "\
[0:a]adelay=0|0[a0];[1:a]adelay=15360|15360[a1];[2:a]adelay=37350|37350[a2];\
[3:a]adelay=55750|55750[a3];[4:a]adelay=74510|74510[a4];[5:a]adelay=103330|103330[a5];\
[6:a]adelay=124080|124080[a6];\
[a0][a1][a2][a3][a4][a5][a6]amix=inputs=7:duration=longest:dropout_transition=0[vo];\
[7:a]atrim=0:140.36,volume=0.1,afade=t=out:st=135.36:d=5[bed];\
[vo][bed]amix=inputs=2:duration=first:dropout_transition=0[a]" \
 -map "[a]" -c:a aac -b:a 192k -t 140.36 build/final/mix.aac
echo "audio mixed"

# ---- 4) Mux ----
ffmpeg -y -v error -i build/final/video.mp4 -i build/final/mix.aac \
 -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart vaultguard-final.mp4
echo "=== DONE ==="
ffprobe -v error -show_entries stream=width,height,r_frame_rate,codec_name -show_entries format=duration,size -of default=noprint_wrappers=1 vaultguard-final.mp4
