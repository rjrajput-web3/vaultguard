"""Audio build v3: locked VO (fit to 140.416s) + user's cinematic music bed
at -20dB + synthesized SFX (whooshes at transitions, UI hum on dashboards)."""
import subprocess, numpy as np

SR = 44100
V2 = "/home/hatch/workspace/vaultguard/demo/v2"
MUSIC = "/home/hatch/workspace/user/files/Creatures-of-the-Night_chosic.com__chosic.com__1_t6gb.mp3"
TOTAL = 140.416
# xfade transition centers in the final video
BOUNDS = [15.36, 37.35, 55.75, 74.51, 103.33, 124.08]
# dashboard scenes for UI hum: S3 (37.35-56.15), S6 (103.33-124.46)
HUM_SEGS = [(37.35, 56.15), (103.33, 124.46)]

def whoosh(dur=0.9):
    n = int(SR * dur)
    t = np.arange(n) / SR
    noise = np.random.default_rng(3).standard_normal(n)
    env = np.sin(np.pi * t / dur) ** 2
    sweep = np.sin(2 * np.pi * (180 + 900 * t / dur) * t)
    w = noise * 0.25 + sweep * 0.35
    k = np.ones(64) / 64
    w = np.convolve(w, k, mode="same")
    return (w * env * 0.5).astype(np.float32)

def hum(dur):
    n = int(SR * dur)
    t = np.arange(n) / SR
    h = 0.06 * np.sin(2 * np.pi * 55 * t) + 0.03 * np.sin(2 * np.pi * 110 * t)
    f = min(1.0, dur / 2)
    env = np.ones(n)
    m = int(SR * f)
    env[:m] = np.linspace(0, 1, m)
    env[-m:] = np.linspace(1, 0, m)
    return (h * env * 0.5).astype(np.float32)

def main():
    # 1) VO: fit locked vo.aac exactly to TOTAL (uniform 2.4% tempo, no content cut)
    vo_dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", f"{V2}/build/vo.aac"],
        capture_output=True, text=True, check=True).stdout.strip())
    atempo = vo_dur / TOTAL
    print(f"VO {vo_dur:.2f}s -> {TOTAL:.2f}s (atempo={atempo:.4f})", flush=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"{V2}/build/vo.aac",
                    "-af", f"atempo={atempo:.5f}",
                    "-c:a", "aac", "-b:a", "160k", f"{V2}/build/v3_vo.aac"], check=True)
    # 2) bed: user's track, trim to TOTAL, -20dB, gentle fades
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", MUSIC,
                    "-t", str(TOTAL),
                    "-af", f"volume=0.1,afade=t=in:st=0:d=1.5,afade=t=out:st={TOTAL-4}:d=4",
                    "-c:a", "aac", "-b:a", "128k", f"{V2}/build/v3_bed.aac"], check=True)
    # 3) SFX track
    n = int(SR * TOTAL)
    sfx = np.zeros(n, dtype=np.float32)
    w = whoosh()
    wn = len(w)
    for b in BOUNDS:
        s = int(b * SR)
        e = min(n, s + wn)
        sfx[s:e] += w[:e - s] * 0.7
    for a, b in HUM_SEGS:
        h = hum(b - a)
        s = int(a * SR)
        e = min(n, s + len(h))
        sfx[s:e] += h[:e - s]
    import wave
    pcm = np.clip(sfx * 32767, -32768, 32767).astype(np.int16)
    with wave.open(f"{V2}/build/v3_sfx.wav", "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"{V2}/build/v3_sfx.wav",
                    "-c:a", "aac", "-b:a", "128k", f"{V2}/build/v3_sfx.aac"], check=True)
    # 4) mix: VO on top, bed ducked -20dB, SFX subtle
    subprocess.run(["ffmpeg", "-y", "-v", "error",
                    "-i", f"{V2}/build/v3_vo.aac", "-i", f"{V2}/build/v3_bed.aac",
                    "-i", f"{V2}/build/v3_sfx.aac",
                    "-filter_complex",
                    "[0:a][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=0,alimiter=limit=0.95[a]",
                    "-map", "[a]", "-c:a", "aac", "-b:a", "192k",
                    f"{V2}/build/v3_mix.aac"], check=True)
    print("AUDIO V3 DONE", flush=True)

if __name__ == "__main__":
    main()
