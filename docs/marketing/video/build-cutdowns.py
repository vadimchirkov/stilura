#!/usr/bin/env python3
"""Build Stilura vertical/feed cutdowns from narrow renders of artifact/demo.html (same timeline as docs/demo.mp4, which is never touched).
Needs ffmpeg and Google Chrome (captions are rendered as PNGs because this ffmpeg has no drawtext).
First: node docs/marketing/video/render-narrow.mjs 9x16 && node docs/marketing/video/render-narrow.mjs 4x5\nUsage: python3 docs/marketing/video/build-cutdowns.py [9x16] [4x5] [hook]"""
import subprocess, os, html, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FF = "/opt/homebrew/bin/ffmpeg"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = HERE
W = "/tmp/stilura-cutdowns"
os.makedirs(W, exist_ok=True); os.makedirs(OUT, exist_ok=True)
SKEL = [(5.3, 6.3), (10.0, 10.7), (16.1, 16.9), (18.1, 18.7)]  # loading skeletons, played 3x
SPEED = 3.0

def segments(a, b):
    """Split [a,b] into (start,end,speed) around skeleton windows."""
    out, t = [], a
    for s, e in SKEL:
        if e <= t or s >= b: continue
        if s > t: out.append((t, s, 1.0))
        out.append((max(s, t), min(e, b), SPEED)); t = min(e, b)
    if t < b: out.append((t, b, 1.0))
    return out

def to_out(src_t, a, b):
    o = 0.0
    for s, e, sp in segments(a, b):
        if src_t <= s: break
        o += (min(src_t, e) - s) / sp
    return o

BEATS = [  # source start, big caption, small line
    (0.0, "AI slop", "watch it get fixed in place"),
    (2.5, "⌘K: kill it", "select, ask, preview"),
    (7.4, "pick a version", "↓ flips options, Tab keeps one"),
    (13.8, "/ adds a line", "R asks for another take"),
    (20.8, "you keep the last word", "Esc turns the AI down"),
    (23.0, "npx stilura", "open-source Markdown editor"),
]

def render_caption(path, w, h, cap_y, big, small, big_px):
    doc = f"""<html><head><style>
body{{margin:0;width:{w}px;height:{h}px;background:transparent;font-family:Helvetica,'Helvetica Neue',sans-serif;color:#1d1c1a;position:relative}}
.c{{position:absolute;left:0;right:0;top:{cap_y}px;text-align:center}}
.big{{font-weight:700;font-size:{big_px}px;letter-spacing:-1px;line-height:1.1}}
.small{{margin-top:22px;font-size:{int(big_px*0.42)}px;color:#5e5b55}}
</style></head><body><div class="c"><div class="big" style="font-size:{big_px if len(big) <= 16 else int(big_px*0.72)}px;white-space:nowrap">{html.escape(big)}</div><div class="small">{html.escape(small)}</div></div></body></html>"""
    hp = path + ".html"; open(hp, "w").write(doc)
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--default-background-color=00000000", f"--window-size={w},{h}",
                    f"--screenshot={path}", "file://" + hp], check=True, capture_output=True)

def render_chrome(path, w, h, header_y, footer_y):
    doc = f"""<html><head><style>
body{{margin:0;width:{w}px;height:{h}px;background:transparent;font-family:Helvetica,sans-serif;position:relative}}
.h{{position:absolute;top:{header_y}px;left:0;right:0;text-align:center;font-size:40px;color:#7a766e}}
.h b{{color:#1d1c1a}}
.f{{position:absolute;top:{footer_y}px;left:0;right:0;text-align:center;font-size:38px;color:#7a766e;font-family:Menlo,monospace}}
</style></head><body><div class="h"><b>Stilura</b> · local Markdown editor with AI</div>
<div class="f">github.com/vadimchirkov/stilura</div></body></html>"""
    hp = path + ".html"; open(hp, "w").write(doc)
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    "--default-background-color=00000000",
                    f"--window-size={w},{h}", f"--screenshot={path}", "file://" + hp],
                   check=True, capture_output=True)

def build(name, w, h, a, b, layout, beats, src):
    """src: a narrow render from render-narrow.mjs (same timeline as docs/demo.mp4, already w x h)."""
    base = f"{W}/{name}_base.png"
    render_chrome(base, w, h, layout["header"], layout["footer"])
    caps = []
    for i, (st, big, small) in enumerate(beats):
        if st >= b: continue
        nxt = beats[i + 1][0] if i + 1 < len(beats) and beats[i + 1][0] < b else b
        p = f"{W}/{name}_cap{i}.png"
        render_caption(p, w, h, layout["cap"], big, small, layout["big"])
        caps.append((p, to_out(max(st, a), a, b), to_out(nxt, a, b)))
    total = to_out(b, a, b)
    # timeline: trimmed + sped segments of the source
    segs = segments(a, b)
    fc = []
    for i, (s, e, sp) in enumerate(segs):
        fc.append(f"[0:v]trim={s}:{e},setpts=(PTS-STARTPTS)/{sp}[s{i}]")
    fc.append("".join(f"[s{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=1:a=0,fps=30,scale={w}:{h},setsar=1[ta]")
    fc.append(f"[ta][1:v]overlay=0:0[v0]")
    last = "v0"
    for j, (p, t0, t1) in enumerate(caps):
        fc.append(f"[{last}][{j+2}:v]overlay=0:0:enable='between(t,{t0:.3f},{t1:.3f})'[c{j}]")
        last = f"c{j}"
    fc.append(f"[{last}]format=yuv420p[out]")
    cmd = [FF, "-v", "error", "-y", "-i", src, "-i", base]
    for p, _, _ in caps: cmd += ["-i", p]
    cmd += ["-filter_complex", ";".join(fc), "-map", "[out]", "-t", f"{total:.3f}",
            "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-movflags", "+faststart",
            "-r", "30", f"{OUT}/{name}.mp4"]
    subprocess.run(cmd, check=True)
    print(name, f"{total:.2f}s", [(round(t0, 2), round(t1, 2)) for _, t0, t1 in caps])

# Text starts at y~860 (9x16) and y~455 (4x5) in the narrow renders; captions sit above it.
L916 = dict(header=150, cap=290, big=110, footer=1780)
L45 = dict(header=40, cap=115, big=88, footer=1275)
N916, N45 = "/tmp/stilura-narrow-9x16.mp4", "/tmp/stilura-narrow-4x5.mp4"
which = sys.argv[1:] or ["9x16", "4x5", "hook"]
if "9x16" in which: build("stilura-9x16", 1080, 1920, 0.0, 25.4, L916, BEATS, N916)
if "4x5" in which: build("stilura-4x5", 1080, 1350, 0.0, 25.4, L45, BEATS, N45)
if "hook" in which: build("stilura-hook-12s", 1080, 1350, 0.5, 13.6, L45, BEATS[:3], N45)
