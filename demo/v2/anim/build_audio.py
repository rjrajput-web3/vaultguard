"""Audio build: VO concat + bed at -20dB + synthesized SFX (whooshes, UI hum)."""
import subprocess, numpy as np

SR = 44100
V2 = "/home/hatch/workspace/vaultguard/demo/v2"
# scene boundaries (with 0.4s overlaps) for SFX placement
BOUNDS = [17.54, 43.17, 64.17, 84.83, 120.21, 142.94]
TOTAL = 162.45
# terminal scenes for UI hum: S3 (43.17-64.57), S6 (120.21-143.34)
HUM_SEGS = [(43.17, 64.57), (120.21, 143.34)]

def whoosh(dur=0.9):
    n = int(SR * dur)
    t = np.arange(n) / SR
    noise = np.random.default_rng(3).standard_normal(n)
    # band-sweep: amplitude envelope up-down, simple lowpass via cumsum
    env = np.sin(np.pi * t / dur) ** 2
    # crude sweep by modulating with rising sine
    sweep = np.sin(2 * np.pi * (180 + 900 * t / dur) * t)
    w = noise * 0.25 + sweep * 0.35
    # smooth
    k = np.ones(64) / 64
    w = np.convolve(w, k, mode="same")
    return (w * env * 0.5).astype(np.float32)

def hum(dur):
    n = int(SR * dur)
    t = np.arange(n) / SR
    h = 0.06 * np.sin(2 * np.pi * 55 * t) + 0.03 * np.sin(2 * np.pi * 110 * t)
    # gentle fade in/out
    f = min(1.0, dur / 2)
    env = np.ones(n)
    m = int(SR * f)
    env[:m] = np.linspace(0, 1, m)
    env[-m:] = np.linspace(1, 0, m)
    return (h * env * 0.5).astype(np.float32)

def main():
    # 1) VO concat
    vo_files = "|".join(f"{V2}/vo/s{i}.mp3" for i in range(1, 8))
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"concat:{vo_files}",
                    "-c:a", "aac", "-b:a", "160k", f"{V2}/build/vo.aac"], check=True)
    # 2) bed: trim, -20dB, fade out
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", "/home/hatch/workspace/hampi-film/audio/bed.wav",
                    "-t", str(TOTAL),
                    "-af", f"volume=0.1,afade=t=out:st={TOTAL-5}:d=5",
                    "-c:a", "aac", "-b:a", "128k", f"{V2}/build/bed.aac"], check=True)
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
    # write wav then aac
    import wave
    pcm = np.clip(sfx * 32767, -32768, 32767).astype(np.int16)
    with wave.open(f"{V2}/build/sfx.wav", "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"{V2}/build/sfx.wav",
                    "-c:a", "aac", "-b:a", "128k", f"{V2}/build/sfx.aac"], check=True)
    # 4) mix all
    subprocess.run(["ffmpeg", "-y", "-v", "error",
                    "-i", f"{V2}/build/vo.aac", "-i", f"{V2}/build/bed.aac", "-i", f"{V2}/build/sfx.aac",
                    "-filter_complex", "[0:a][1:a][2:a]amix=inputs=3:duration=first:dropout_transition=0[a]",
                    "-map", "[a]", "-c:a", "aac", "-b:a", "192k",
                    f"{V2}/build/mix.aac"], check=True)
    print("AUDIO DONE")

if __name__ == "__main__":
    main()
