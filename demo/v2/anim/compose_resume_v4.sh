#!/bin/bash
# VAULTRY v4 compose RESUME from step 3 (steps 1-2 already done)
set -e
cd ~/workspace/vaultguard/demo/v2
mkdir -p build/final_v4 build/v4clips
V2=/home/hatch/workspace/vaultguard/demo/v2
TR=0.7
TN=21
ZP="fps=30,format=yuv420p"

mktrans() { # $1=A $2=dA $3=B $4=out
  local A=$1 dA=$2 B=$3 out=$4
  local tail_start=$(python3 -c "print(round($dA - $TR, 3))")
  ffmpeg -y -v error -i build/v4clips/${A}.mp4 \
    -vf "trim=start=${tail_start}:end=${dA},setpts=PTS-STARTPTS,zoompan=z='1+0.14*on/$TN':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" \
    -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/${out}_a.mp4
  ffmpeg -y -v error -i build/v4clips/${B}.mp4 \
    -vf "trim=start=0:end=${TR},setpts=PTS-STARTPTS,zoompan=z='1.14-0.14*on/$TN':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" \
    -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/${out}_b.mp4
  ffmpeg -y -v error -i build/v4clips/${out}_a.mp4 -i build/v4clips/${out}_b.mp4 \
    -filter_complex "[0:v][1:v]xfade=transition=fade:duration=${TR}:offset=0,format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/${out}.mp4
  echo "transition $out done"
}

echo "=== 3) 3D push transitions ==="
mktrans s1 15.55 s2 t1
mktrans s2 23.05 s3 t2
mktrans s3 19.20 s4 t3
mktrans s4 19.58 s5 t4
mktrans s5 29.64 s6 t5
mktrans s6 21.58 s7 t6

echo "=== 4) concat ==="
ffmpeg -y -v error -i build/v4clips/s1.mp4 -vf "trim=start=0:end=15.55,setpts=PTS-STARTPTS" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/b1.mp4
ffmpeg -y -v error -i build/v4clips/s2.mp4 -vf "trim=start=0.7:end=23.05,setpts=PTS-STARTPTS" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/b2.mp4
ffmpeg -y -v error -i build/v4clips/s3.mp4 -vf "trim=start=0.7:end=19.20,setpts=PTS-STARTPTS" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/b3.mp4
ffmpeg -y -v error -i build/v4clips/s4.mp4 -vf "trim=start=0.7:end=19.58,setpts=PTS-STARTPTS" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/b4.mp4
ffmpeg -y -v error -i build/v4clips/s5.mp4 -vf "trim=start=0.7:end=29.64,setpts=PTS-STARTPTS" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/b5.mp4
ffmpeg -y -v error -i build/v4clips/s6.mp4 -vf "trim=start=0.7:end=21.58,setpts=PTS-STARTPTS" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/b6.mp4
ffmpeg -y -v error -i build/v4clips/s7.mp4 -vf "trim=start=0.7,setpts=PTS-STARTPTS" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/b7.mp4
printf "file 'b1.mp4'\nfile 't1.mp4'\nfile 'b2.mp4'\nfile 't2.mp4'\nfile 'b3.mp4'\nfile 't3.mp4'\nfile 'b4.mp4'\nfile 't4.mp4'\nfile 'b5.mp4'\nfile 't5.mp4'\nfile 'b6.mp4'\nfile 't6.mp4'\nfile 'b7.mp4'\n" > build/v4clips/clist.txt
ffmpeg -y -v error -f concat -safe 0 -i build/v4clips/clist.txt -c:v libx264 -preset medium -crf 18 -r 30 build/final_v4/v4_nocap.mp4
echo "concat done"

echo "=== 5) captions (VO-synced) ==="
FF=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
CAP=$V2/captions
ffmpeg -y -v error -i build/final_v4/v4_nocap.mp4 -vf "\
drawtext=fontfile=$FF:textfile=$CAP/cap1.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,0.8,14.8)',\
drawtext=fontfile=$FF:textfile=$CAP/cap2.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,17.2,37.9)',\
drawtext=fontfile=$FF:textfile=$CAP/cap3.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,40.3,57.1)',\
drawtext=fontfile=$FF:textfile=$CAP/cap4.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,59.5,76.7)',\
drawtext=fontfile=$FF:textfile=$CAP/cap5.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,79.0,106.3)',\
drawtext=fontfile=$FF:textfile=$CAP/cap6.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,108.6,127.9)',\
drawtext=fontfile=$FF:textfile=$CAP/cap7.txt:fontsize=30:fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=20:x=(w-text_w)/2:y=h-60:enable='between(t,130.2,145.0)'" \
 -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/final_v4/v4.mp4
echo "captions done"

echo "=== 6) mux v4 audio ==="
ffmpeg -y -v error -i build/final_v4/v4.mp4 -i build/v4_mix.aac \
 -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart vaultguard-final.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 vaultguard-final.mp4
echo "=== V4 COMPOSE COMPLETE ==="
