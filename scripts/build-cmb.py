#!/usr/bin/env python3
"""
Build public/textures/cmb.jpg: the cosmic microwave background from NASA's WMAP 9-year
Internal Linear Combination map (LAMBDA, public domain), reprojected from HEALPix to an
equirectangular image in galactic coordinates (u = l / 360°, v from b = +90° at the top).

No astropy or healpy needed: a minimal FITS binary-table reader and the HEALPix nested
ang2pix formula (Gorski et al. 2005) in numpy.

    python3 -I scripts/build-cmb.py
"""
import math
import pathlib
import urllib.request

import numpy as np

URL = "https://lambda.gsfc.nasa.gov/data/map/dr5/dfp/ilc/wmap_ilc_9yr_v5.fits"
ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "node_modules" / ".cache" / "cmb" / "wmap_ilc_9yr_v5.fits"
OUT = ROOT / "public" / "textures" / "cmb.jpg"
WIDTH, HEIGHT = 2048, 1024
LIMIT_MK = 0.3  # colour scale: ±300 µK


def read_fits_table(path):
    """Return (header dict of the first BINTABLE, raw table bytes)."""
    data = path.read_bytes()
    pos = 0
    while True:
        cards = {}
        while True:
            block = data[pos : pos + 2880].decode("ascii")
            pos += 2880
            done = False
            for i in range(0, 2880, 80):
                card = block[i : i + 80]
                key = card[:8].strip()
                if key == "END":
                    done = True
                    break
                if card[8:10] == "= ":
                    value = card[10:].split("/")[0].strip().strip("'").strip()
                    cards[key] = value
            if done:
                break
        rows = int(cards.get("NAXIS2", 0)) if cards.get("NAXIS", "0") != "0" else 0
        width = int(cards.get("NAXIS1", 0)) if rows else 0
        size = width * rows
        if cards.get("XTENSION") == "BINTABLE":
            return cards, data[pos : pos + size]
        pos += ((size + 2879) // 2880) * 2880


def spread_bits(v):
    """Interleave: bit k of v goes to bit 2k."""
    out = np.zeros_like(v)
    for k in range(16):
        out |= ((v >> k) & 1) << (2 * k)
    return out


def ang2pix_nest(nside, theta, phi):
    z = np.cos(theta)
    za = np.abs(z)
    tt = np.mod(phi, 2 * math.pi) / (math.pi / 2)  # [0, 4)
    face = np.zeros(theta.shape, dtype=np.int64)
    ix = np.zeros(theta.shape, dtype=np.int64)
    iy = np.zeros(theta.shape, dtype=np.int64)

    eq = za <= 2.0 / 3.0
    # Equatorial region
    t1 = nside * (0.5 + tt[eq])
    t2 = nside * (z[eq] * 0.75)
    jp = (t1 - t2).astype(np.int64)
    jm = (t1 + t2).astype(np.int64)
    ifp = jp // nside
    ifm = jm // nside
    f = np.where(ifp == ifm, ifp | 4, np.where(ifp < ifm, ifp, ifm + 8))
    face[eq] = f
    ix[eq] = jm & (nside - 1)
    iy[eq] = nside - (jp & (nside - 1)) - 1

    # Polar caps
    po = ~eq
    ntt = np.minimum(3, tt[po].astype(np.int64))
    tp = tt[po] - ntt
    tmp = nside * np.sqrt(3 * (1 - za[po]))
    jp = np.minimum((tp * tmp).astype(np.int64), nside - 1)
    jm = np.minimum(((1 - tp) * tmp).astype(np.int64), nside - 1)
    north = z[po] >= 0
    face[po] = np.where(north, ntt, ntt + 8)
    ix[po] = np.where(north, nside - jm - 1, jp)
    iy[po] = np.where(north, nside - jp - 1, jm)

    return face * nside * nside + spread_bits(ix) + 2 * spread_bits(iy)


def colormap(t):
    """Diverging blue–white–red for temperature t in [-1, 1]."""
    stops = np.array(
        [
            [-1.0, 0.0, 0.0, 0.55],
            [-0.5, 0.1, 0.45, 0.95],
            [0.0, 0.98, 0.95, 0.85],
            [0.5, 1.0, 0.55, 0.1],
            [1.0, 0.6, 0.0, 0.0],
        ]
    )
    out = np.zeros(t.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(t, stops[:, 0], stops[:, c + 1])
    return out


def main():
    if not CACHE.exists():
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(URL, CACHE)
    cards, table = read_fits_table(CACHE)
    assert cards["ORDERING"] == "NESTED", cards.get("ORDERING")
    nside = int(cards["NSIDE"])
    rows = np.frombuffer(table, dtype=">f4").reshape(-1, int(cards["TFIELDS"]))
    temperature = rows[:, 0].astype(np.float64)  # mK

    # Output grid: l = 0..360° left to right, b = +90..-90° top to bottom (pixel centres).
    l = (np.arange(WIDTH) + 0.5) / WIDTH * 2 * math.pi
    b = math.pi / 2 - (np.arange(HEIGHT) + 0.5) / HEIGHT * math.pi
    lon, lat = np.meshgrid(l, b)
    pix = ang2pix_nest(nside, math.pi / 2 - lat, lon)
    sky = temperature[pix]
    rgb = colormap(np.clip(sky / LIMIT_MK, -1, 1))
    img = (rgb * 255).astype(np.uint8)

    # Write as PPM, then let ImageMagick make a compact JPEG.
    ppm = OUT.with_suffix(".ppm")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(ppm, "wb") as fh:
        fh.write(f"P6 {WIDTH} {HEIGHT} 255\n".encode())
        fh.write(img.tobytes())
    import subprocess

    subprocess.run(["convert", str(ppm), "-quality", "85", str(OUT)], check=True)
    ppm.unlink()
    print(f"cmb.jpg {WIDTH}x{HEIGHT} from {len(temperature):,} HEALPix pixels (Nside {nside}); "
          f"T range {sky.min():.3f}..{sky.max():.3f} mK")


main()
