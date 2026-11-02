#!/bin/bash
# VAULTRY v4 final compose — premium 3D product-launch film
# - 3D official logo (S1/S7 re-rendered), deepened glass dashboards (S3/S6)
# - 3D push transitions (0.7s, in VO silence gaps) replacing basic fades
# - 3D feature title overlays (S3/S5/S6 heads)
# - VO-synced scene spans, captions re-timed, natural-pace VO (no atempo)
# 1920x1080@30fps H.264 + AAC
set -e
cd ~/workspace/vaultguard/demo/v2
mkdir -p build/final_v4 build/v4clips
V2=/home/hatch/workspace/vaultguard/demo/v2
S4RAW=$(ls raw/s4/*.webm | head -1)
TR=0.7
TN=21  # 0.7s * 30fps
ZP="fps=30,format=yuv420p"

echo "=== 1) scene trims + gentle push-in ==="
# S1: [0, 16.25]
ffmpeg -y -v error -i build/s1_v4.mp4 -t 16.25 -vf "zoompan=z='1+0.025*on/487':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/s1.mp4
# S2: [0, 23.75]
ffmpeg -y -v error -i build/s2.mp4 -t 23.75 -vf "zoompan=z='1+0.025*on/712':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/s2.mp4
# S3: [0, 19.90]
ffmpeg -y -v error -i build/s3_v4.mp4 -t 19.90 -vf "zoompan=z='1+0.025*on/597':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/s3.mp4
# S4: crop stale nav, [0, 20.28]
ffmpeg -y -v error -ss 28 -i "$S4RAW" -t 20.28 -vf "fps=30,crop=1920:1004:0:76,scale=1920:1080,zoompan=z='1+0.025*on/608':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080,format=yuv420p" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/s4.mp4
# S5: [0, 30.34]
ffmpeg -y -v error -i build/s5.mp4 -t 30.34 -vf "zoompan=z='1+0.025*on/910':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/s5.mp4
# S6: [0, 22.28]
ffmpeg -y -v error -i build/s6_v4.mp4 -t 22.28 -vf "zoompan=z='1+0.025*on/668':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/s6.mp4
# S7: [0, 18.47]
ffmpeg -y -v error -i build/s7_v4.mp4 -t 18.47 -vf "zoompan=z='1+0.03*on/554':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/s7.mp4
echo "trims done"

echo "=== 2) 3D title overlays on S3/S5/S6 heads ==="
for sc in s3 s5 s6; do
  ffmpeg -y -v error -i build/v4clips/${sc}.mp4 -framerate 30 -i build/titles/${sc}/f%03d.png \
    -filter_complex "[0:v][1:v]overlay=0:0:enable='between(t,0.6,4.0)'[v]" \
    -map "[v]" -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/v4clips/${sc}_t.mp4
  mv build/v4clips/${sc}_t.mp4 build/v4clips/${sc}.mp4
done
echo "titles done"

echo "=== 3) 3D push transitions ==="
# pairs: (A, dA, B) — tail = last TR of A, head = first TR of B
mktrans() { # $1=A $2=dA $3=B $4=out
  local A=$1 dA=$2 B=$3 out=$4
  local tail_start=$(python3 -c "print(round($dA - $TR, 3))")
  ffmpeg -y -v error -i build/v4clips/${A}.mp4 \
    -vf "trim=start=${tail_start}:end=${dA}:setpts=PTS-STARTPTS,zoompan=z='1+0.14*on/$TN':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" \
    -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/${out}_a.mp4
  ffmpeg -y -v error -i build/v4clips/${B}.mp4 \
    -vf "trim=start=0:end=${TR}:setpts=PTS-STARTPTS,zoompan=z='1.14-0.14*on/$TN':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:${ZP}" \
    -c:v libx264 -preset medium -crf 18 -r 30 build/v4clips/${out}_b.mp4
  ffmpeg -y -v error -i build/v4clips/${out}_a.mp4 -i build/v4clips/${out}_b.mp4 \
    -filter_complex "[0][1]xfade=transition=fade:duration=${TR}:offset=0" \
    -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/v4clips/${out}.mp4
  rm build/v4clips/${out}_a.mp4 build/v4clips/${out}_b.mp4
}
mktrans s1 16.25 s2 t1
mktrans s2 23.75 s3 t2
mktrans s3 19.90 s4 t3
mktrans s4 20.28 s5 t4
mktrans s5 30.34 s6 t5
mktrans s6 22.28 s7 t6
echo "transitions done"

echo "=== 4) bodies + concat ==="
# body_N = scene N minus transition overlaps
cutbody() { # $1=in $2=start $3=dur $4=out
  ffmpeg -y -v error -ss $2 -i build/v4clips/$1.mp4 -t $3 -c:v libx264 -preset medium -crf 18 -r 30 -pix_fmt yuv420p build/v4clips/$4.mp4
}
cutbody s1.mp4 0 15.55 b1
cutbody s2.mp4 0.7 22.35 b2
cutbody s3.mp4 0.7 18.50 b3
cutbody s4.mp4 0.7 18.88 b4
cutbody s5.mp4 0.7 28.94 b5
cutbody s6.mp4 0.7 20.88 b6
cutbody s7.mp4 0.7 17.77 b7
printf "file 'b1.mp4'\nfile 't1.mp4'\nfile 'b2.mp4'\nfile 't2.mp4'\nfile 'b3.mp4'\nfile 't3.mp4'\nfile 'b4.mp4'\nfile 't4.mp4'\nfile 'b5.mp4'\nfile 't5.mp4'\nfile 'b6.mp4'\nfile 't6.mp4'\nfile 'b7.mp4'\n" > build/v4clips/list.txt
ffmpeg -y -v error -f concat -safe 0 -i build/v4clips/list.txt -c copy build/final_v4/v4_nocap.mp4
echo "assembled"

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
echo "=== DONE ==="
ffprobe -v error -show_entries stream=width,height,r_frame_rate,codec_name -show_entries format=duration,size -of default=noprint_wrappers=1 vaultguard-final.mp4
