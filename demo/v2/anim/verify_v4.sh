#!/bin/bash
# V4 final verification: ffprobe, decode, frames, branding, captions, audio
set -u
V=~/workspace/vaultguard/demo/v2/vaultguard-final.mp4
echo "=== ffprobe ==="
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,avg_frame_rate,codec_name -of default=noprint_wrappers=1 "$V"
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -of default=noprint_wrappers=1 "$V"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$V"
echo "=== full decode ==="
ffmpeg -v error -i "$V" -f null - 2>&1 && echo "DECODE OK"
echo "=== frame grabs (scenes + transition edges) ==="
mkdir -p /tmp/v4verify
# scene mids: 8, 27, 48, 68, 92, 118, 138
# transition centers ±0.3: 15.6,16.2 / 38.65,39.25 / 57.85,58.45 / 77.43,78.03 / 107.07,107.67 / 128.65,129.25
for t in 8 15.6 16.2 27 38.65 39.25 48 57.85 58.45 68 77.43 78.03 92 107.07 107.67 118 128.65 129.25 138; do
  ffmpeg -v error -ss $t -i "$V" -frames:v 1 /tmp/v4verify/f_$t.png -y
done
python3 - <<'EOF'
import glob, numpy as np
from PIL import Image
files = sorted(glob.glob('/tmp/v4verify/f_*.png'))
black = 0
for f in files:
    arr = np.array(Image.open(f)).astype(np.float32)
    mean = arr.mean()
    status = "OK" if mean > 8 else "BLACK!"
    if mean <= 8: black += 1
    print(f"{f.split('/')[-1]}: mean={mean:.1f} {status}")
print(f"total {len(files)}, black {black}")
EOF
echo "=== audio presence (RMS per 10s window) ==="
ffmpeg -v error -i "$V" -map a -af "astats=metadata=1:reset=10,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - 2>&1 | grep -c "RMS_level" | xargs -I{} echo "windows with RMS: {}"
