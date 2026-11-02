"""Audio build v4: natural-pace VO (segments + 0.8s gaps, NO tempo change) +
user's music bed at -20dB + SFX (whooshes at transitions, UI hum on dashboards).
Deterministic numpy mixing (no alimiter). Transition centers + hum spans are
written to build/v4_timeline.json for the video compose step."""
import json
import subprocess
import numpy as np

SR = 44100
V2 = "/home/hatch/workspace/vaultguard/demo/v2"
MUSIC = "/home/hatch/workspace/user/files/Creatures-of-the-Night_chosic.com__chosic.com__1_t6gb.mp3"
GAP = 0.8
TAIL = 1.2

# transition centers (s) — in VO gaps, clear of speech (verified post-build)
TRANS_CENTERS = [15.90, 38.95, 58.15, 77.73, 107.37, 128.95]
# dashboard scenes for UI hum (video-timeline spans, filled in by compose)
HUM_SEGS = [(38.60, 58.50), (107.02, 129.30)]


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


def load_wav(path):
    import wave
    with wave.open(path, "rb") as wf:
        nch = wf.getnchannels()
        assert wf.getsampwidth() == 2
        assert wf.getframerate() == SR
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
        if nch == 2:
            pcm = pcm.reshape(-1, 2).mean(axis=1).astype(np.int16)
    return pcm.astype(np.float32) / 32768.0


def main():
    # 1) VO: concatenate per-scene wavs with GAP silence (natural pace, no atempo)
    segs = [load_wav(f"{V2}/vo_wav/s{i}.wav") for i in range(1, 8)]
    gap = np.zeros(int(SR * GAP), dtype=np.float32)
    vo = segs[0]
    bounds = []  # (start,end) of each VO segment in the new track
    t = 0.0
    for i, s in enumerate(segs):
        bounds.append((t, t + len(s) / SR))
        vo = np.concatenate([vo, gap, segs[i + 1]] if i < 6 else [vo])
        t += len(s) / SR + (GAP if i < 6 else 0)
    total_vo = t
    total = total_vo + TAIL
    print(f"VO segments: {['%.2f-%.2f' % b for b in bounds]}", flush=True)
    print(f"VO total {total_vo:.2f}s -> mix total {total:.2f}s", flush=True)

    # 2) bed: user's track, trim/pad to total, -20dB, gentle fades
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", MUSIC,
                    "-t", str(total),
                    "-af", f"volume=0.1,afade=t=in:st=0:d=1.5,afade=t=out:st={total-4}:d=4",
                    "-c:a", "aac", "-b:a", "128k", f"{V2}/build/v4_bed.aac"], check=True)

    # 3) SFX: whooshes at transition centers, hum during dashboard spans
    n = int(SR * total)
    sfx = np.zeros(n, dtype=np.float32)
    w = whoosh()
    wn = len(w)
    for c in TRANS_CENTERS:
        s = int((c - 0.45) * SR)
        e = min(n, s + wn)
        if s < n and e > 0:
            sfx[max(0, s):e] += w[:e - max(0, s)] * 0.7
    for a, b in HUM_SEGS:
        h = hum(b - a)
        s = int(a * SR)
        e = min(n, s + len(h))
        sfx[s:e] += h[:e - s]
    import wave
    pcm = np.clip(sfx * 32767, -32768, 32767).astype(np.int16)
    with wave.open(f"{V2}/build/v4_sfx.wav", "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"{V2}/build/v4_sfx.wav",
                    "-c:a", "aac", "-b:a", "128k", f"{V2}/build/v4_sfx.aac"], check=True)

    # 4) deterministic numpy mix: VO + bed(-20dB) + sfx, peak-normalize to 0.95
    def dec_aac(path, dur_s):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path,
                              "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                             capture_output=True, check=True).stdout
        a = np.frombuffer(raw, dtype=np.float32)
        need = int(dur_s * SR)
        if len(a) < need:
            a = np.pad(a, (0, need - len(a)))
        return a[:need]

    bed = dec_aac(f"{V2}/build/v4_bed.aac", total)
    sfxd = dec_aac(f"{V2}/build/v4_sfx.aac", total)
    von = len(vo) / SR
    vop = np.zeros(int(total * SR), dtype=np.float32)
    vop[:len(vo)] = vo
    mix = vop + bed + sfxd
    peak = np.abs(mix).max()
    mix = mix / peak * 0.95
    print(f"mix peak before norm: {peak:.3f}", flush=True)
    pcm = np.clip(mix * 32767, -32768, 32767).astype(np.int16)
    with wave.open(f"{V2}/build/v4_mix.wav", "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"{V2}/build/v4_mix.wav",
                    "-c:a", "aac", "-b:a", "192k", f"{V2}/build/v4_mix.aac"], check=True)

    # also save VO-only track for speech-boundary measurement
    pcm = np.clip(np.pad(vo, (0, int(total * SR) - len(vo))) * 32767,
                  -32768, 32767).astype(np.int16)
    with wave.open(f"{V2}/build/v4_vo.wav", "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR)
        wf.writeframes(pcm.tobytes())
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"{V2}/build/v4_vo.wav",
                    "-c:a", "aac", "-b:a", "160k", f"{V2}/build/v4_vo.aac"], check=True)

    json.dump({"vo_bounds": bounds, "total": total,
               "trans_centers": TRANS_CENTERS, "hum_segs": HUM_SEGS},
              open(f"{V2}/build/v4_timeline.json", "w"), indent=1)
    print("AUDIO V4 DONE", flush=True)


if __name__ == "__main__":
    main()
