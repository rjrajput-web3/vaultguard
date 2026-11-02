"""S4 — record the policy edit flow on the NEW policy console.
Real browser, real mouse, human pacing. 1920x1080, ~32s raw (cut to 21.06s in compose).
Flow: load /policy -> scroll to Spending limits -> click MAX PER TRANSACTION ->
select-all, type 750 at human speed -> scroll to Save -> click -> wait for success status.
"""
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3100"
OUT = "/home/hatch/workspace/vaultguard/demo/v2/raw/s4"

def drift(pg, x0, y0, x1, y1, steps=30, delay=0.035):
    pg.mouse.move(x0, y0, steps=10)
    for i in range(steps + 1):
        x = x0 + (x1 - x0) * i / steps
        y = y0 + (y1 - y0) * i / steps
        pg.mouse.move(x, y, steps=1)
        time.sleep(delay)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--force-device-scale-factor=1"])
    ctx = b.new_context(viewport={"width": 1920, "height": 1080},
                        record_video_dir=OUT,
                        record_video_size={"width": 1920, "height": 1080})
    pg = ctx.new_page()
    pg.goto(BASE + "/policy", wait_until="networkidle", timeout=30000)
    pg.wait_for_timeout(2500)

    # settle: slow drift over the header (page has fade-up animations)
    drift(pg, 960, 200, 960, 350, steps=40, delay=0.04)
    pg.wait_for_timeout(1200)

    # the MAX PER TRANSACTION input is visible ~y=830 in 1080p; scroll slightly to center it
    pg.mouse.wheel(0, 120)
    pg.wait_for_timeout(1200)

    # locate the input: first number input under "MAX PER TRANSACTION"
    inp = pg.locator('input[type="number"]').first
    inp.scroll_into_view_if_needed()
    pg.wait_for_timeout(800)
    box = inp.bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    drift(pg, cx - 300, cy - 120, cx, cy, steps=30, delay=0.04)
    pg.wait_for_timeout(600)
    pg.mouse.click(cx, cy)
    pg.wait_for_timeout(700)
    # select all + type 750 at human speed
    pg.keyboard.press("ControlOrMeta+a")
    pg.wait_for_timeout(400)
    for ch in "750":
        pg.keyboard.type(ch, delay=90)
        time.sleep(0.12)
    pg.wait_for_timeout(900)

    # scroll to the Save button and click it
    btn = pg.locator("button.vg-btn", has_text="Save policy")
    btn.scroll_into_view_if_needed()
    pg.wait_for_timeout(900)
    bbox = btn.bounding_box()
    bx, by = bbox["x"] + bbox["width"] / 2, bbox["y"] + bbox["height"] / 2
    drift(pg, bx - 350, by - 100, bx, by, steps=30, delay=0.04)
    pg.wait_for_timeout(500)
    pg.mouse.click(bx, by)
    # wait for the success status
    pg.wait_for_selector("text=Policy saved", timeout=15000)
    pg.wait_for_timeout(800)
    # scroll UP to reveal the green success alert at the top of the form
    pg.mouse.wheel(0, -900)
    pg.wait_for_timeout(1500)
    drift(pg, 960, 350, 960, 280, steps=30, delay=0.05)
    pg.wait_for_timeout(2500)

    time.sleep(1.0)
    ctx.close()
    b.close()
print("S4 RAW DONE")
