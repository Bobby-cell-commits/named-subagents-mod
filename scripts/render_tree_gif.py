"""Render captured tmux frames (capture-pane -e) into assets/demo.gif.

Capture (a private tmux server, fresh session, this checkout loaded with --plugin-dir):
    bash scripts/capture_demo.sh <scratch_project_dir> rec
which is, in short:
    T="tmux -L nsdemo -f /dev/null"
    $T new-session -d -s d -x 150 -y 36 -c "$DIR"; $T set -s focus-events on
    $T send-keys -t d "claude --model haiku --setting-sources project,local --plugin-dir ." Enter
    $T send-keys -t d -l "<prompt>"; $T capture-pane -e -p -t d > rec/f001-s1-typed.ans
    $T send-keys -t d Enter
    until the task tree is empty: sleep 0.5; $T capture-pane -e -p -t d > rec/fNNN-s1.ans
then the same for "/names set …", "/names use …" and the second prompt. $DIR has the
fullscreen layout set, so the agents pane docks beside the transcript.
Render:
    python3 scripts/render_tree_gif.py rec assets/demo.gif
Keep the recording, so the GIF can be redrawn without a new session:
    python3 scripts/render_tree_gif.py rec assets/demo.gif --keep assets/demo-frames
    python3 scripts/render_tree_gif.py assets/demo-frames assets/demo.gif
The frames are chosen by rule from each file's name (fNNN-<scene>.ans), so any recording the
capture script makes will do: a typed line and a /names answer are held, a running scene is
every third frame (STEP), and the first frame with every agent of a scene in the task tree
and the last frame are held longer.
The title bar's version is read from .claude-plugin/plugin.json.
Fonts: JetBrains Mono NL Nerd Font, DejaVu Sans, Noto Color Emoji.

Draws the whole captured screen: the transcript, the agents pane, the prompt and the task
tree, each cell as tmux gave it. Two things are taken out, here and in the kept frames: the
banner (the plan, the folder's path, the session link) is blanked, and the home directory in
a printed path reads `~`. Frame timing is chosen for readability.
"""

import json
import os
import re
import sys
import unicodedata
from PIL import Image, ImageDraw, ImageFont

SRC, DST = sys.argv[1], sys.argv[2]
KEEP = sys.argv[sys.argv.index("--keep") + 1] if "--keep" in sys.argv else None
STEP = int(os.environ.get("STEP", 3))
FONT = "/home/bogdan/.local/share/fonts/JetBrainsMonoNF/JetBrainsMonoNLNerdFontMono-Regular.ttf"
BOLD = FONT.replace("Regular", "Bold")
EMOJI = "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf"
FS = 15
font, bold = ImageFont.truetype(FONT, FS), ImageFont.truetype(BOLD, FS)
symfont = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", FS)
HOME = os.path.expanduser("~")
VERSION = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".claude-plugin", "plugin.json")))["version"]
SYM = set("✢✻✽✶✳·")  # Claude Code spinner glyphs the mono font lacks
efont = ImageFont.truetype(EMOJI, 109)
CW = round(font.getlength("M"))
CH = round(FS * 1.45)
BG, FG = (30, 30, 46), (205, 214, 244)
PAD_X, PAD_Y, TITLE_H = 18, 14, 34
COLOURS = int(os.environ.get("COLOURS", 128))


def x256(n):
    base = [
        (0, 0, 0),
        (205, 49, 49),
        (13, 188, 121),
        (229, 229, 16),
        (36, 114, 200),
        (188, 63, 188),
        (17, 168, 205),
        (229, 229, 229),
        (102, 102, 102),
        (241, 76, 76),
        (35, 209, 139),
        (245, 245, 67),
        (59, 142, 234),
        (214, 112, 214),
        (41, 184, 219),
        (255, 255, 255),
    ]
    if n < 16:
        return base[n]
    if n < 232:
        n -= 16
        c = [0, 95, 135, 175, 215, 255]
        return (c[n // 36], c[(n // 6) % 6], c[n % 6])
    v = 8 + (n - 232) * 10
    return (v, v, v)


OSC = re.compile(r"\x1b\][^\x07\x1b]*(\x07|\x1b\\)")
SGR = re.compile(r"\x1b\[([0-9;:]*)m")


def parse(line, state):
    """-> list of (char, fg, bold, dim, bg) with SGR applied. tmux carries the colours over
    a line break (a prompt's grey band runs on to its second line), so `state` does too."""
    line = OSC.sub("", line)
    out, (fg, b, dim, bg) = [], state
    pos = 0
    for m in SGR.finditer(line):
        for ch in line[pos : m.start()]:
            out.append((ch, fg, b, dim, bg))
        ps = [int(p) if p else 0 for p in re.split("[;:]", m.group(1) or "0")]
        i = 0
        while i < len(ps):
            p = ps[i]
            if p == 0:
                fg, b, dim, bg = FG, False, False, None
            elif p == 1:
                b = True
            elif p == 2:
                dim = True
            elif p == 22:
                b = dim = False
            elif p == 39:
                fg = FG
            elif p == 49:
                bg = None
            elif 30 <= p <= 37:
                fg = x256(p - 30)
            elif 90 <= p <= 97:
                fg = x256(p - 90 + 8)
            elif p in (38, 48) and i + 1 < len(ps):
                c = None
                if ps[i + 1] == 5:
                    c = x256(ps[i + 2])
                    i += 2
                elif ps[i + 1] == 2:
                    c = tuple(ps[i + 2 : i + 5])
                    i += 4
                if p == 38:
                    fg = c
                else:
                    bg = c
            i += 1
        pos = m.end()
    for ch in line[pos:]:
        out.append((ch, fg, b, dim, bg))
    state[:] = fg, b, dim, bg
    return out


def plain(cells):
    return "".join(c[0] for c in cells)


def width(ch):
    if unicodedata.category(ch) in ("Mn", "Cf") or ch == "\ufe0f":
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


BANNER = re.compile(r"\s*(▐▛|▝▜|▝▝)")
ESC = re.compile(r"\x1b\[[0-9;:]*m")


def clean(text):
    """A captured screen with what a reader should not get taken out, every column where it
    was: the banner's three lines are blanked up to the pane's edge (or a toast's), and the
    home directory in a path reads `~`, the spaces it saves put back after the path."""
    out = []
    for raw in OSC.sub("", text).split("\n"):
        if BANNER.match(ESC.sub("", raw)):
            at = raw.find("│")
            head, tail = (raw, "") if at < 0 else (raw[:at], raw[at:])
            # plain blanks, then the colour changes the blanked text made, for what follows it
            raw = "\x1b[0m" + " " * sum(width(c) for c in ESC.sub("", head)) + "".join(ESC.findall(head)) + tail
        raw = re.sub(re.escape(HOME) + r"(\S*)", lambda m: "~" + m.group(1) + " " * (len(HOME) - 1), raw)
        out.append(raw)
    return "\n".join(out)


def screen(path):
    """-> the frame's rows of cells, and how many agents its task tree names."""
    state = [FG, False, False, None]
    rows = [parse(ln, state) for ln in clean(open(path, encoding="utf-8").read()).split("\n")]
    while rows and not plain(rows[-1]).strip():
        rows.pop()
    return rows, sum(1 for r in rows if plain(r).lstrip().startswith("◯"))


def is_emoji(ch):
    return ord(ch) >= 0x1F000


def draw(frame_rows, H):
    W = PAD_X * 2 + CW * COLS
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, TITLE_H], fill=(24, 24, 37))
    for k, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([16 + k * 22, 11, 28 + k * 22, 23], fill=c)
    d.text((W // 2, TITLE_H // 2), f"claude  ·  named-subagents-mod {VERSION}", fill=(140, 140, 170), font=font, anchor="mm")
    y = TITLE_H + PAD_Y
    for cells in frame_rows:
        x = PAD_X
        col = 0
        skip = set()
        for j, (ch, fg, b, dim, bg) in enumerate(cells):
            if j in skip:
                continue
            w = width(ch)
            if w == 0:
                continue
            if col >= COLS:
                break
            if bg:
                d.rectangle([x, y, x + CW * w - 1, y + CH - 1], fill=bg)
            if dim:
                fg = tuple(int(v * 0.6 + BG[i] * 0.4) for i, v in enumerate(fg))
            if is_emoji(ch):
                g = Image.new("RGBA", (136, 128), (0, 0, 0, 0))
                ImageDraw.Draw(g).text((0, 0), ch + "\ufe0f", font=efont, embedded_color=True)
                g = g.crop(g.getbbox() or (0, 0, 1, 1)).resize((CH - 4, CH - 4), Image.LANCZOS)
                img.paste(g, (x, y + 1), g)
                # Emoji draw 2 cells wide. The terminal counted some (⌨ ✍) as 1 cell and
                # padded with 2 spaces; absorb one so every label reads "emoji name".
                rest = [c[0] for c in cells[j + 1 : j + 4] if c[0] != "\ufe0f"]
                if width(ch) == 1 and rest[:2] == [" ", " "]:
                    skip.add(next(k for k in range(j + 1, len(cells)) if cells[k][0] == " "))
                w = 2
            elif ch == "⎿":  # in no installed text font: two strokes
                d.line([x + 3, y + 4, x + 3, y + CH - 8, x + CW - 1, y + CH - 8], fill=fg, width=1)
            elif ch == "⏸":  # nor is this: two bars
                for bx in (x + 1, x + 5):
                    d.rectangle([bx, y + 6, bx + 1, y + CH - 7], fill=fg)
            elif ch != " ":
                d.text((x, y), ch, fill=fg, font=symfont if ch in SYM - {"·"} else (bold if b else font))
            x += CW * w
            col += w
        y += CH
    return img


# Scene 1: the prompt, the pane opening and its roster filling with the tree's four names, the batch's
# receipt. Scene 2: /names set, /names use, the second prompt, the roster filling from the new set.
found = sorted((int(m[1]), m[2], os.path.join(SRC, n)) for n in os.listdir(SRC) if (m := re.match(r"f(\d{3})-(.+)\.ans$", n)))
if KEEP:
    os.makedirs(KEEP, exist_ok=True)
    for _, _, f in found:
        open(os.path.join(KEEP, os.path.basename(f)), "w", encoding="utf-8").write(clean(open(f, encoding="utf-8").read()))
shots = [(tag, *screen(f)) for _, tag, f in found]
full = {tag: max(named for t, _, named in shots if t == tag) for tag in ("s1", "s2")}
last_of = {tag: i for i, (tag, _, _) in enumerate(shots)}
picked, seen_full = [], set()
for i, (tag, rows, named) in enumerate(shots):
    hold = None
    if tag.endswith("-typed"):
        hold = 1800 if tag in ("s1-typed", "s2-typed") else 1200
    elif tag in ("set", "use"):
        hold = 2200 if i == last_of[tag] else None
    else:
        first_full = named == full[tag] and tag not in seen_full
        if first_full:
            seen_full.add(tag)
        since = sum(1 for t, _, _ in shots[:i] if t == tag)
        if first_full or since % STEP == 0 or i == last_of[tag]:
            hold = 1800 if first_full else 2500 if i == last_of[tag] else 450
    if hold:
        picked.append((rows, hold))
COLS = max(sum(width(c[0]) for c in r) for rows, _ in picked for r in rows)
H = TITLE_H + PAD_Y * 2 + CH * max(len(rows) for rows, _ in picked)
frames, durs, last = [], [], None
for rows, hold in picked:
    key = "\n".join(plain(r) for r in rows)
    if key == last:
        durs[-1] += hold
        continue
    last = key
    frames.append(draw(rows, H))
    durs.append(hold)
durs[-1] = 3500
# One shared palette for every frame: the text is a dozen colours and their blends with the background.
pal = Image.new("RGB", (frames[0].width, H * 2))
pal.paste(frames[len(frames) // 3], (0, 0))
pal.paste(frames[-1], (0, H))
pal = pal.quantize(colors=COLOURS, method=Image.MEDIANCUT, dither=Image.NONE)
frames = [f.quantize(palette=pal, dither=Image.NONE) for f in frames]
frames[0].save(DST, save_all=True, append_images=frames[1:], duration=durs, loop=0, optimize=True)
print(len(frames), "frames", sum(durs) / 1000, "s", frames[0].size, os.path.getsize(DST) // 1024, "KB")
