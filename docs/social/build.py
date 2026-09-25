#!/usr/bin/env python3
"""Regenerate the launch posters.

    python3 docs/social/build.py

Change SITE_URL below and re-run; nothing else needs touching. Everything is
drawn from public/brand/, so the logo can never drift out of sync with the
one in the app.
"""
import base64
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
BRAND = ROOT / "public" / "brand"
OUT = ROOT / "docs" / "social"

# --- the only line you normally edit -------------------------------------
SITE_URL = "github.com/shokkanuly/Chainstory"

# --- brand constants, measured from the supplied logo --------------------
GRADIENT = (
    '<linearGradient id="cs-bar" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#6e6afa"/>'
    '<stop offset="0.45" stop-color="#8b5cf6"/>'
    '<stop offset="1" stop-color="#5598de"/>'
    "</linearGradient>"
)
BARS = (
    '<polygon points="300,66.8 667,0 667,127.3 300,194.1"/>'
    '<polygon points="0,236.8 667,170.1 667,297.4 0,364.1"/>'
    '<polygon points="0,406.9 500,340.2 500,467.5 0,534.2"/>'
)
MARK_RATIO = 667 / 534      # mark width per unit of mark height
GAP_RATIO = 74 / 139        # lockup gap between mark and wordmark
WORD_TOP_RATIO = 14 / 139   # wordmark sits slightly below the mark's cap line
WORD_H_RATIO = 123 / 139
WORD_ASPECT = 705 / 123


def _b64(path):
    return base64.b64encode(path.read_bytes()).decode()


WORDMARK = {
    "ink": _b64(BRAND / "chainstory-wordmark-ink.png"),
    "white": _b64(BRAND / "chainstory-wordmark-white.png"),
}


def lockup(x, y, mark_h, ink="ink"):
    """The full ChainStory lockup, positioned by the mark's top-left corner.

    The mark is drawn as vector so it stays crisp at any size; the wordmark is
    the supplied artwork, so the letterforms are exact rather than a guess at
    which typeface was used.
    """
    mark_w = mark_h * MARK_RATIO
    scale = mark_h / 534
    wx = x + mark_w + mark_h * GAP_RATIO
    wh = mark_h * WORD_H_RATIO
    return (
        f'<g transform="translate({x},{y}) scale({scale:.6f})" fill="url(#cs-bar)">{BARS}</g>'
        f'<image x="{wx:.1f}" y="{y + mark_h * WORD_TOP_RATIO:.1f}" '
        f'width="{wh * WORD_ASPECT:.1f}" height="{wh:.1f}" '
        f'href="data:image/png;base64,{WORDMARK[ink]}"/>'
    )


def lockup_width(mark_h):
    return mark_h * (MARK_RATIO + GAP_RATIO + WORD_H_RATIO * WORD_ASPECT)


FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
MONO = "'SF Mono', Menlo, monospace"


def svg(w, h, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" font-family="{FONT}">'
        f"<defs>{GRADIENT}</defs>{body}</svg>"
    )


def poster_plain_english():
    lw = lockup_width(56)
    return svg(1200, 1200, f'''
  <rect width="1200" height="1200" fill="#ffffff"/>
  {lockup(88, 96, 56)}
  <rect x="{88 + lw + 24:.0f}" y="108" width="74" height="34" rx="17" fill="#f3eeff"/>
  <text x="{88 + lw + 61:.0f}" y="131" font-size="15" font-weight="600" letter-spacing="1.6" fill="#8b5cf6" text-anchor="middle">BETA</text>

  <text x="88" y="306" font-size="78" font-weight="700" letter-spacing="-2.5" fill="#111114">Your wallet&#8217;s history,</text>
  <text x="88" y="396" font-size="78" font-weight="700" letter-spacing="-2.5" fill="url(#cs-bar)">in plain English.</text>

  <rect x="88" y="474" width="1024" height="166" rx="24" fill="#f5f5f7"/>
  <text x="128" y="518" font-size="14" font-weight="600" letter-spacing="2.4" fill="#9ca3af">WHAT A BLOCK EXPLORER SHOWS YOU</text>
  <text x="128" y="566" font-size="23" fill="#6b7280" font-family="{MONO}">0x7ff36ab5000000000000000000000000000000000000&#8230;</text>
  <text x="128" y="604" font-size="23" fill="#6b7280" font-family="{MONO}">Value: 2000000000000000000 wei</text>

  <g stroke="#d4d4d8" stroke-width="4" stroke-linecap="round">
    <line x1="600" y1="664" x2="600" y2="700"/>
    <polyline points="586,688 600,702 614,688" fill="none"/>
  </g>

  <rect x="88" y="726" width="1024" height="162" rx="24" fill="#ffffff" stroke="#e7e7ea" stroke-width="2"/>
  <text x="128" y="770" font-size="14" font-weight="600" letter-spacing="2.4" fill="#9ca3af">WHAT CHAINSTORY SHOWS YOU</text>
  <text x="128" y="836" font-size="36" font-weight="600" letter-spacing="-0.8" fill="#111114">Swapped 2.0 ETH for 3,400 USDC on Uniswap V3</text>

  <g font-size="19" font-weight="500">
    <rect x="88" y="936" width="252" height="54" rx="27" fill="#eef1ff"/>
    <text x="214" y="971" fill="#3a5fd0" text-anchor="middle">5 EVM chains</text>
    <rect x="356" y="936" width="292" height="54" rx="27" fill="#e6fbf8"/>
    <text x="502" y="971" fill="#0e8579" text-anchor="middle">Draft Form 8949 CSV</text>
    <rect x="664" y="936" width="300" height="54" rx="27" fill="#f3eeff"/>
    <text x="814" y="971" fill="#7048d8" text-anchor="middle">Live approval audit</text>
  </g>

  <rect x="88" y="1032" width="336" height="86" rx="43" fill="#111114"/>
  <text x="256" y="1084" font-size="27" font-weight="600" fill="#ffffff" text-anchor="middle">Paste an address &#8594;</text>
  <text x="456" y="1070" font-size="21" font-weight="600" fill="#111114">{SITE_URL}</text>
  <text x="456" y="1100" font-size="18" fill="#6b7280">No wallet connection. No signature. Open source, MIT.</text>

  <text x="88" y="1166" font-size="17" fill="#9ca3af">Ethereum &#183; Arbitrum &#183; Base &#183; Optimism &#183; Polygon</text>''')


def poster_four_tools():
    card = lambda x, y, kicker, kc, title, l1, l2: f'''
    <rect x="{x}" y="{y}" width="500" height="196" rx="24" fill="#1a1a1f" stroke="#2a2a31" stroke-width="2"/>
    <text x="{x + 40}" y="{y + 54}" font-size="14" font-weight="600" letter-spacing="2.4" fill="{kc}">{kicker}</text>
    <text x="{x + 40}" y="{y + 102}" font-size="30" font-weight="600" fill="#ffffff">{title}</text>
    <text x="{x + 40}" y="{y + 142}" font-size="19" fill="rgba(255,255,255,0.62)">{l1}</text>
    <text x="{x + 40}" y="{y + 170}" font-size="19" fill="rgba(255,255,255,0.62)">{l2}</text>'''
    return svg(1200, 1200, f'''
  <rect width="1200" height="1200" fill="#111114"/>
  {lockup(88, 96, 56, ink="white")}

  <text x="88" y="288" font-size="72" font-weight="700" letter-spacing="-2.4" fill="#ffffff">One address in.</text>
  <text x="88" y="372" font-size="72" font-weight="700" letter-spacing="-2.4" fill="url(#cs-bar)">Four answers out.</text>
  {card(88, 464, "STORY FEED", "#6e6afa", "Readable history", "Every transaction as one", "plain-English sentence.")}
  {card(612, 464, "TAX &#183; DRAFT", "#22d3c8", "FIFO cost basis", "Short/long-term lots, gas", "deducted, 8949 CSV + PDF.")}
  {card(88, 684, "APPROVALS", "#8b5cf6", "What can drain you", "Live ERC-20 allowances,", "decoded from calldata.")}
  {card(612, 684, "PRE-SCAN RISK", "#f5a524", "Before you sign", "Verification, deploy age,", "proxy and admin powers.")}

  <rect x="88" y="944" width="1024" height="2" fill="#2a2a31"/>
  <text x="88" y="1006" font-size="22" fill="rgba(255,255,255,0.72)">Read-only. Nothing to connect, nothing to sign, nothing to approve.</text>

  <rect x="88" y="1044" width="336" height="86" rx="43" fill="#ffffff"/>
  <text x="256" y="1096" font-size="27" font-weight="600" fill="#111114" text-anchor="middle">Try the beta &#8594;</text>
  <text x="456" y="1082" font-size="21" font-weight="600" fill="#ffffff">{SITE_URL}</text>
  <text x="456" y="1112" font-size="18" fill="rgba(255,255,255,0.55)">Beta. Tax output is a draft &#8212; limitations documented in the README.</text>''')


def poster_x_card():
    return svg(1600, 900, f'''
  <rect width="1600" height="900" fill="#ffffff"/>
  {lockup(96, 78, 54)}

  <text x="96" y="304" font-size="84" font-weight="700" letter-spacing="-3" fill="#111114">Understand any wallet</text>
  <text x="96" y="398" font-size="84" font-weight="700" letter-spacing="-3" fill="url(#cs-bar)">without connecting yours.</text>
  <text x="96" y="480" font-size="27" fill="#6b7280">Paste an address. Get a readable history, a draft tax report, an approval audit and a risk check.</text>

  <rect x="96" y="548" width="1408" height="128" rx="24" fill="#f5f5f7"/>
  <text x="140" y="596" font-size="14" font-weight="600" letter-spacing="2.4" fill="#9ca3af">EXPLORER</text>
  <text x="140" y="636" font-size="22" fill="#6b7280" font-family="{MONO}">swapExactETHForTokens &#183; 2000000000000000000 wei</text>
  <text x="900" y="596" font-size="14" font-weight="600" letter-spacing="2.4" fill="#8b5cf6">CHAINSTORY</text>
  <text x="900" y="636" font-size="24" font-weight="600" fill="#111114">Swapped 2.0 ETH for 3,400 USDC</text>

  <rect x="96" y="724" width="322" height="84" rx="42" fill="#111114"/>
  <text x="257" y="775" font-size="26" font-weight="600" fill="#ffffff" text-anchor="middle">Paste an address &#8594;</text>
  <text x="452" y="762" font-size="20" font-weight="600" fill="#111114">{SITE_URL}</text>
  <text x="452" y="792" font-size="17" fill="#6b7280">Beta &#183; open source &#183; MIT &#183; 5 EVM chains &#183; read-only</text>''')


POSTERS = [
    ("poster-plain-english", poster_plain_english, 1200, 1200),
    ("poster-four-tools", poster_four_tools, 1200, 1200),
    ("poster-x-card", poster_x_card, 1600, 900),
]


def render(name, markup, w, h):
    """qlmanage only emits square thumbnails, so pad to a square, render, crop."""
    (OUT / f"{name}.svg").write_text(markup)
    side = max(w, h)
    pad = (side - h) // 2
    body = markup.split(">", 1)[1].rsplit("</svg>", 1)[0]
    square = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{side}" height="{side}" '
        f'viewBox="0 0 {side} {side}" font-family="{FONT}">'
        f'<rect width="{side}" height="{side}" fill="#ffffff"/>'
        f'<g transform="translate(0,{pad})">{body}</g></svg>'
    )
    with tempfile.TemporaryDirectory() as tmp:
        src = pathlib.Path(tmp) / f"{name}.svg"
        src.write_text(square)
        subprocess.run(
            ["qlmanage", "-t", "-s", str(side), "-o", tmp, str(src)],
            capture_output=True, check=True,
        )
        thumb = pathlib.Path(tmp) / f"{name}.svg.png"
        if not thumb.exists():
            sys.exit(f"render failed for {name}")
        im = Image.open(thumb).convert("RGB").crop((0, pad, w, pad + h))
        im.save(OUT / f"{name}.png")
    return im.size


if __name__ == "__main__":
    print(f"URL on posters: {SITE_URL}\n")
    for name, fn, w, h in POSTERS:
        got = render(name, fn(), w, h)
        print(f"  {name}.png  {got[0]}x{got[1]}" + ("" if got == (w, h) else "  <-- WRONG SIZE"))
