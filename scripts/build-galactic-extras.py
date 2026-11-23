#!/usr/bin/env python3
"""
Build public/data/galactic-extras.json: four real datasets for the Milky Way, all public.

- S-stars: the stars orbiting Sgr A*, the Milky Way's central black hole, with the orbits fitted
  by Gillessen et al. 2017 (ApJ 837, 30; VizieR J/ApJ/837/30, table3): semi-major axis (arcsec),
  e, i, Ω, ω, periapse time, period. Their black hole: 4.28 × 10⁶ M☉ at R0 = 8.32 kpc (same paper).
- Hypervelocity stars: the MMT Hypervelocity Star Survey (Brown et al. 2012, ApJ 751, 55; VizieR
  J/ApJ/751/55, table1): stars leaving the Galaxy, with distances, galactic l, b and their
  Galactic rest-frame radial velocities. S5-HVS1 (Koposov et al. 2020, MNRAS 491, 2465), at
  1,755 km/s, traced back to Sgr A*, is added by hand from that paper.
- The Radcliffe Wave: its best-fit model (Konietzka et al. 2024, Nature 628, 62; Harvard Dataverse
  doi:10.7910/DVN/F98QHY, CC0): points along the wave, heliocentric galactic x, y, z (pc) and
  vertical velocity (km/s), thinned to every 5th point.
- The Local Bubble: the distance from the Sun to the inner surface of its shell in every
  direction (Pelgrims et al. 2020, A&A 636, L17; Harvard Dataverse doi:10.7910/DVN/RHPVNC, CC0),
  a HEALPix map (nside 128, RING, galactic), the version smoothed to multipole 10, sampled here
  on a 72 × 37 longitude–latitude grid.

    python3 -I scripts/build-galactic-extras.py   (needs numpy)
"""
import json
import math
import pathlib
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "node_modules" / ".cache" / "galactic-extras"
OUT = ROOT / "public" / "data" / "galactic-extras.json"
VIZIER = "https://vizier.cfa.harvard.edu/viz-bin/asu-tsv?-source={}&-out.max=1000&-out.all"
DATAVERSE = "https://dataverse.harvard.edu/api/access/datafile/{}"


def fetch(name, url):
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=300) as r:
            path.write_bytes(r.read())
    return path.read_bytes()


def vizier_rows(name, source):
    text = fetch(name, VIZIER.format(source)).decode("utf-8", "replace")
    lines = [l for l in text.splitlines() if l and not l.startswith("#")]
    header = lines[0].split("\t")
    rows = []
    for l in lines[3:]:
        cells = [c.strip() for c in l.split("\t")]
        if len(cells) == len(header):
            rows.append(dict(zip(header, cells)))
    return rows


def s_stars():
    out = []
    for r in vizier_rows("sstars.tsv", "J/ApJ/837/30/table3"):
        try:
            a, e, i, node, w, tp, per = (float(r[k]) for k in ("a", "e", "i", "Omega", "w", "Tp", "Per"))
        except ValueError:
            continue
        out.append({"name": r["Star"], "aArcsec": a, "e": e, "i": i, "node": node, "peri": w, "tpYear": tp, "periodYears": per})
    return out


def hypervelocity():
    out = []
    for r in vizier_rows("hvs.tsv", "J/ApJ/751/55/table1"):
        try:
            d, l, b, v = float(r["Dist"]), float(r["GLON"]), float(r["GLAT"]), float(r["Vrf"])
        except ValueError:
            continue
        # The survey's classes: HVSs unbound, pBHVSs probably bound, pHVSs possible.
        kind = {"HVSs": "unbound", "pBHVSs": "bound", "pHVSs": "possible"}.get(r["Type"], "possible")
        out.append({"name": r["Name"] or f"HVS{r['HVS']}", "l": l, "b": b, "dKpc": d, "vKms": v, "kind": kind})
    # S5-HVS1 (Koposov et al. 2020): galactic l, b from its RA 343.6531°, Dec −51.2042°.
    ra, dec = math.radians(343.6531), math.radians(-51.2042)
    eq = np.array([math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)])
    R = np.array([[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445], [-0.8676661490, -0.1980763734, 0.4559837762]])
    g = R @ eq
    out.append({"name": "S5-HVS1", "l": round(math.degrees(math.atan2(g[1], g[0])) % 360, 3), "b": round(math.degrees(math.asin(g[2])), 3), "dKpc": 8.84, "vKms": 1755, "kind": "unbound", "fromSgrA": True})
    return out


def radcliffe():
    text = fetch("radcliffe.tab", DATAVERSE.format(8954305)).decode()
    rows = [l.split("\t") for l in text.strip().splitlines()[1:]]
    pts = [[round(float(x), 1), round(float(y), 1), round(float(z), 1), round(float(vz), 2)] for x, y, z, vz in rows]
    return pts[::5]


def healpix_ring_index(nside, theta, phi):
    """ang2pix in RING ordering (Gorski et al. 2005), for colatitude theta and longitude phi."""
    z = math.cos(theta)
    za = abs(z)
    tt = (phi % (2 * math.pi)) / (0.5 * math.pi)
    if za <= 2 / 3:
        temp1 = nside * (0.5 + tt)
        temp2 = nside * z * 0.75
        jp = int(temp1 - temp2)
        jm = int(temp1 + temp2)
        ir = nside + 1 + jp - jm
        kshift = 1 - (ir & 1)
        ip = (jp + jm - nside + kshift + 1) // 2
        ip = ip % (4 * nside)
        return 2 * nside * (nside - 1) + (ir - 1) * 4 * nside + ip
    tp = tt - int(tt)
    tmp = nside * math.sqrt(3 * (1 - za))
    jp = int(tp * tmp)
    jm = int((1 - tp) * tmp)
    ir = jp + jm + 1
    ip = int(tt * ir)
    ip = ip % (4 * ir)
    return 2 * ir * (ir - 1) + ip if z > 0 else 12 * nside * nside - 2 * ir * (ir + 1) + ip


def local_bubble():
    data = fetch("localbubble.fits", DATAVERSE.format(6477817))
    pos = 0
    hdus = []
    while pos < len(data):
        cards = {}
        while True:
            block = data[pos : pos + 2880].decode("ascii")
            pos += 2880
            done = False
            for k in range(0, 2880, 80):
                card = block[k : k + 80]
                key = card[:8].strip()
                if key == "END":
                    done = True
                    break
                if "=" in card[:10]:
                    cards[key] = card[10:].split("/")[0].strip().strip("'").strip()
            if done:
                break
        naxis = int(cards.get("NAXIS", 0))
        size = int(cards["NAXIS1"]) * int(cards["NAXIS2"]) if naxis == 2 else 0
        hdus.append((cards, pos))
        pos += (size + 2879) // 2880 * 2880
    cards, start = hdus[1]
    nrow, width, nside = int(cards["NAXIS2"]), int(cards["NAXIS1"]), int(cards["NSIDE"])
    cols = [cards[f"TTYPE{k}"] for k in range(1, int(cards["TFIELDS"]) + 1)]
    table = np.frombuffer(data[start : start + nrow * width], dtype=">f8").reshape(nrow, len(cols))
    r = table[:, cols.index("r_in_lmax-10")]
    n_lon, n_lat = 72, 37
    grid = []
    for j in range(n_lat):
        b = -90 + 180 * j / (n_lat - 1)
        for i in range(n_lon):
            l = 360 * i / n_lon
            pix = healpix_ring_index(nside, math.radians(90 - b), math.radians(l))
            grid.append(round(float(r[pix]), 1))
    return {"nLon": n_lon, "nLat": n_lat, "rPc": grid}


def main():
    s = s_stars()
    h = hypervelocity()
    w = radcliffe()
    lb = local_bubble()
    out = {
        "source": "Gillessen et al. 2017 (S-stars); Brown et al. 2012 and Koposov et al. 2020 (hypervelocity stars); Konietzka et al. 2024 (Radcliffe Wave, CC0); Pelgrims et al. 2020 (Local Bubble, CC0)",
        "sgrA": {"massMsun": 4.28e6, "r0Kpc": 8.32},
        "sStars": s,
        "hypervelocity": h,
        "radcliffeWave": w,
        "localBubble": lb,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"{len(s)} S-stars, {len(h)} hypervelocity stars, {len(w)} Radcliffe Wave points; Local Bubble radius {min(lb['rPc']):.0f}–{max(lb['rPc']):.0f} pc; {OUT.stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
