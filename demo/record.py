"""VAULTGUARD demo video — real browser recordings, 1920x1080, one take per scene."""
import re
import sys
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3100"
OUT = "/home/hatch/workspace/vaultguard/demo/raw"


def drift(page, x0, y0, x1, y1, steps=40, delay=0.03):
    page.mouse.move(x0, y0, steps=12)
    for i in range(steps + 1):
        x = x0 + (x1 - x0) * i / steps
        y = y0 + (y1 - y0) * i / steps
        page.mouse.move(x, y, steps=1)
        time.sleep(delay)


def scene_home(pg):
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    drift(pg, 960, 150, 960, 450, steps=50)            # title area
    pg.wait_for_timeout(1000)
    drift(pg, 400, 500, 1500, 500, steps=50)           # sweep report card
    pg.wait_for_timeout(800)
    # hover each report row slowly
    for y in (560, 640, 720, 800):
        drift(pg, 500, y, 1400, y, steps=30, delay=0.04)
        pg.wait_for_timeout(700)
    pg.mouse.wheel(0, 450)                             # scroll to feature cards
    pg.wait_for_timeout(2000)
    for x in (620, 960, 1300):                         # hover the 3 feature cards
        drift(pg, x - 150, 800, x + 150, 800, steps=30, delay=0.04)
        pg.wait_for_timeout(900)
    pg.mouse.wheel(0, -450)                            # scroll back up
    pg.wait_for_timeout(2000)
    drift(pg, 1500, 400, 400, 600, steps=60)           # closing sweep
    pg.wait_for_timeout(1200)
    pg.mouse.wheel(0, 350)
    pg.wait_for_timeout(1800)
    drift(pg, 500, 750, 1400, 750, steps=40)
    pg.mouse.wheel(0, -350)
    pg.wait_for_timeout(1800)


def scene_policy(pg):
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_timeout(1000)
    link = pg.get_by_role("link", name="Vault policy")
    link.scroll_into_view_if_needed()
    pg.wait_for_timeout(500)
    bbox = link.bounding_box()
    drift(pg, 960, 400, bbox["x"] + bbox["width"] / 2, bbox["y"] + bbox["height"] / 2, steps=25)
    pg.mouse.click(bbox["x"] + bbox["width"] / 2, bbox["y"] + bbox["height"] / 2)
    pg.wait_for_load_state("networkidle")
    pg.wait_for_timeout(1500)
    # wait for the policy form to load (API must resolve)
    pg.locator("input").first.wait_for(timeout=20000)
    drift(pg, 960, 300, 960, 600)
    pg.wait_for_timeout(800)
    inp = pg.locator('input[type="number"]').first  # maxSpendPerTx (verified: value 1000)
    inp.scroll_into_view_if_needed()
    pg.wait_for_timeout(600)
    box = inp.bounding_box()
    drift(pg, 960, 400, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=25)
    pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.wait_for_timeout(400)
    pg.keyboard.press("Control+a")
    pg.wait_for_timeout(300)
    pg.keyboard.type("750", delay=90)
    pg.wait_for_timeout(600)
    btn = pg.get_by_role("button", name=re.compile("save", re.I))
    btn.scroll_into_view_if_needed()
    pg.wait_for_timeout(600)
    bbox = btn.bounding_box()
    drift(pg, box["x"], box["y"], bbox["x"] + bbox["width"] / 2, bbox["y"] + bbox["height"] / 2, steps=25)
    pg.mouse.click(bbox["x"] + bbox["width"] / 2, bbox["y"] + bbox["height"] / 2)
    pg.wait_for_timeout(2500)
    # verify save persisted
    drift(pg, 960, 700, 960, 400)


def scene_transcript(pg):
    pg.goto("file:///home/hatch/workspace/vaultguard/demo/transcript.html")
    pg.wait_for_timeout(2000)
    drift(pg, 960, 300, 960, 600)
    for _ in range(9):
        pg.mouse.wheel(0, 180)
        pg.wait_for_timeout(2200)
        drift(pg, 400, 500, 1500, 500, steps=20, delay=0.02)
    pg.wait_for_timeout(2500)


def scene_closing(pg):
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    drift(pg, 300, 800, 1600, 300, steps=50, delay=0.025)
    pg.wait_for_timeout(1500)
    pg.mouse.wheel(0, 300)
    pg.wait_for_timeout(2000)
    drift(pg, 1600, 800, 300, 400, steps=50, delay=0.025)
    pg.wait_for_timeout(2500)


def take(name, fn):
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-device-scale-factor=1"])
        ctx = b.new_context(
            viewport={"width": 1920, "height": 1080},
            record_video_dir=f"{OUT}/{name}",
            record_video_size={"width": 1920, "height": 1080},
        )
        pg = ctx.new_page()
        fn(pg)
        time.sleep(1.0)
        ctx.close()
        b.close()
    print(f"take {name} done", flush=True)


SCENES = {
    "home": scene_home,
    "policy": scene_policy,
    "transcript": scene_transcript,
    "closing": scene_closing,
}

if __name__ == "__main__":
    take(sys.argv[1], SCENES[sys.argv[1]])
