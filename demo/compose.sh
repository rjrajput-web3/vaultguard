#!/bin/bash
# VAULTGUARD demo video composition — 1920x1080@30fps, -threads 2
set -e
cd ~/workspace/vaultguard/demo
mkdir -p build

H=$(ls raw/home/*.webm | head -1)
P=$(ls raw/policy/*.webm | head -1)
T=$(ls raw/transcript/*.webm | head -1)
C=$(ls raw/closing/*.webm | head -1)
FD=0.4  # xfade duration

# 1) Cut exact segments (video seg = VO dur + FD, except last), 30fps, yuv420p
ffmpeg -y -v error -threads 2 -ss 1     -i "$H" -t 19.72 -vf "fps=30,scale=1920:1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 build/v1.mp4
ffmpeg -y -v error -threads 2 -ss 20.72 -i "$H" -t 31.02 -vf "fps=30,scale=1920:1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 build/v2.mp4
ffmpeg -y -v error -threads 2 -ss 8     -i "$P" -t 22.96 -vf "fps=30,scale=1920:1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 build/v3.mp4
ffmpeg -y -v error -threads 2 -ss 2     -i "$T" -t 35.56 -vf "fps=30,scale=1920:1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 build/v4.mp4
ffmpeg -y -v error -threads 2 -ss 2     -i "$C" -t 15.48 -vf "fps=30,scale=1920:1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 build/v5.mp4

# 2) xfade chain: offsets 19.32 / 49.94 / 72.50 / 107.66
ffmpeg -y -v error -threads 2 \
 -i build/v1.mp4 -i build/v2.mp4 -i build/v3.mp4 -i build/v4.mp4 -i build/v5.mp4 \
 -filter_complex "\
[0][1]xfade=transition=fade:duration=${FD}:offset=19.32[x1];\
[x1][2]xfade=transition=fade:duration=${FD}:offset=49.94[x2];\
[x2][3]xfade=transition=fade:duration=${FD}:offset=72.50[x3];\
[x3][4]xfade=transition=fade:duration=${FD}:offset=107.66,fade=t=in:st=0:d=0.5,fade=t=out:st=122.6:d=0.5[v]" \
 -map "[v]" -c:v libx264 -preset medium -crf 18 -r 30 build/video.mp4

# 3) Audio: VO concat + bed at -20dB, bed fades out at end
ffmpeg -y -v error -threads 2 -i "concat:vo/s1.mp3|vo/s2.mp3|vo/s3.mp3|vo/s4.mp3|vo/s5.mp3" -c:a aac -b:a 160k build/vo.aac
ffmpeg -y -v error -threads 2 -i ~/workspace/hampi-film/audio/bed.wav -t 123.2 -af "volume=0.1,afade=t=out:st=118:d=5" -c:a aac -b:a 128k build/bed.aac
ffmpeg -y -v error -threads 2 -i build/vo.aac -i build/bed.aac -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0[a]" -map "[a]" -c:a aac -b:a 192k build/mix.aac

# 4) Mux
ffmpeg -y -v error -threads 2 -i build/video.mp4 -i build/mix.aac -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart vaultguard-demo.mp4
echo "=== DONE ==="
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,r_frame_rate -of default=noprint_wrappers=1 vaultguard-demo.mp4
