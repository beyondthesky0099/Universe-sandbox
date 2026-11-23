#!/usr/bin/env python3
"""
Build public/data/laniakea.bin: Laniakea, our home supercluster, as the motions of galaxies define
it, for the Universe view.

Source: the CosmicFlows-4 density and peculiar-velocity grids of Courtois et al. 2023 (A&A 670,
L15, "Gravity in the local Universe: density and velocity fields using CosmicFlows-4"), Zenodo
record 20653238, CC BY 4.0. Grids of 128³ voxels over a 1000 h⁻¹ Mpc box centred on the Milky
Way, in supergalactic coordinates. The array axes are (SGX, SGY, SGZ) in numpy order, and the
velocity's components are (vSGX, vSGY, vSGZ) in units of 52 km/s. Both were checked here: the
grid's velocity divergence tracks its density with correlation 1.000 only in that order, and the
velocity at the centre, (−404, 336, −161) km/s, matches the Local Group's motion through the
microwave background, (−413, 344, −323) km/s.

The basin of attraction follows Dupuy et al. 2019 and Dupuy & Courtois 2023 (A&A 678, A176): a
basin is the set of voxels whose streamlines end at the same attractor. The attractor is found by
pointer-following (each voxel points to the neighbour, of 26, most nearly along its velocity, and
the Milky Way's voxel's path ends in a small loop). Then the streamline from every voxel within
250 h⁻¹ Mpc is integrated (fourth-order Runge–Kutta, 600 half-voxel steps) and those ending within
15 h⁻¹ Mpc of that attractor form Laniakea; streamlines avoid the 26 fixed directions' bias toward
the grid planes. Here Laniakea has a volume of 1.95 × 10⁶ (h⁻¹ Mpc)³ and its attractor lies at
about SG (−47, 8, 47) h⁻¹ Mpc; Dupuy & Courtois give 1.9 × 10⁶ and (−62, −8, 39). It holds Virgo,
Fornax, Centaurus, Antlia, Hydra, Norma and Pavo, and not Coma, Perseus, Shapley or Hercules.

Drawn from it:
  - flow lines: 3,000 streamlines of the velocity field (fourth-order Runge–Kutta, half-voxel
    steps), seeded where the matter is (probability ∝ (1 + δ)^1.5): 1,600 in Laniakea and 1,400
    around it within 200 h⁻¹ Mpc, flagged by whether their seed lies in Laniakea;
  - Laniakea's surface: a smoothed surface-nets mesh of its basin;
  - its basin as a 128³ bit mask, so the app (and the tests) can tell what lies inside.

Positions are converted to the Universe view's frame: h⁻¹ Mpc to Mpc with the map's Hubble
constant (Planck 2018, h = 0.6766: the galaxies there are placed by redshift with it, so the flows
line up with them), supergalactic to galactic (de Vaucouleurs: the supergalactic pole at
l = 47.37°, b = 6.32°, SGL = 0 at l = 137.37°, b = 0), then (x, y, z)gal → (x, z, −y).

Layout (little-endian): "LANI", uint32 version 1, float32 unit (Mpc per int16 step),
float32 attractor x, y, z, uint32 nLines, nPoints, nVerts, nTris, uint32 mask size N,
float32 voxel (h⁻¹ Mpc), float32 centre (voxel index of the origin), float32 h; then
uint16 line lengths [nLines], uint8 flags [nLines] (1 = in Laniakea), int16 points [nPoints × 3],
int16 vertices [nVerts × 3], uint32 triangles [nTris × 3], uint8 mask bits [N³ / 8]
(bit (i·N + j)·N + k for voxel (SGX i, SGY j, SGZ k), least significant bit first).

    python3 -I scripts/build-laniakea.py   (needs numpy; grids cached in node_modules/.cache/laniakea/)
"""
import hashlib
import math
import pathlib
import struct
import urllib.request

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE = ROOT / "node_modules" / ".cache" / "laniakea"
OUT = ROOT / "public" / "data" / "laniakea.bin"
RECORD = "https://zenodo.org/api/records/20653238/files/{}/content"
FILES = {
    "CF4_new_128-z008_velocity.fits": "15a0b84431c9e85635bd36101b3aa624",
    "CF4_new_128-z008_delta.fits": "090da12e30a27cc8c37012898f4c5b41",
}
N = 128
VOXEL = 1000 / N  # h⁻¹ Mpc
CENTRE = 63.5  # the origin sits between the middle voxels
H = 0.6766  # the Universe view's Hubble constant / 100 (src/sim/cosmology.ts)
UNIT = 1 / 40  # Mpc per int16 step: ±819 Mpc
SEEDS_IN = 1600  # flow lines starting in Laniakea
SEEDS_OUT = 1400  # and around it
SEEDS = SEEDS_IN + SEEDS_OUT
SEED_RADIUS = 200  # h⁻¹ Mpc
STEP = 0.5  # voxels
MAX_STEPS = 700
BASIN_RADIUS = 250  # h⁻¹ Mpc: the voxels traced to find the basin
BASIN_STEPS = 600
ARRIVED = 15  # h⁻¹ Mpc from the attractor
rng = np.random.default_rng(20140904)  # Laniakea's discovery was published on 4 September 2014


def fetch(name):
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print(f"downloading {name}")
        with urllib.request.urlopen(RECORD.format(name), timeout=300) as r:
            path.write_bytes(r.read())
    data = path.read_bytes()
    if hashlib.md5(data).hexdigest() != FILES[name]:
        raise SystemExit(f"{name}: checksum mismatch (delete {path} and run again)")
    return data


def read_fits(data, shape):
    pos = 0
    while True:
        block = data[pos : pos + 2880]
        pos += 2880
        if any(block[i : i + 8] == b"END     " for i in range(0, 2880, 80)):
            break
    n = int(np.prod(shape))
    return np.frombuffer(data[pos : pos + 4 * n], dtype=">f4").reshape(shape).astype(np.float64)


def galactic_unit(l, b):
    l, b = math.radians(l), math.radians(b)
    return np.array([math.cos(b) * math.cos(l), math.cos(b) * math.sin(l), math.sin(b)])


# Rows: the supergalactic axes in galactic coordinates (galactic vector → supergalactic).
SGZ = galactic_unit(47.37, 6.32)
SGX = galactic_unit(137.37, 0)
SG_FROM_GAL = np.array([SGX, np.cross(SGZ, SGX), SGZ])


def voxel_to_scene(p):
    """Voxel coordinates (…, 3) → the Universe view's frame (Mpc)."""
    sg = (np.asarray(p, float) - CENTRE) * VOXEL / H
    gal = sg @ SG_FROM_GAL  # (SG_FROM_GAL.T @ sg) for each row
    return np.stack([gal[..., 0], gal[..., 2], -gal[..., 1]], axis=-1)


def basins(v):
    """Label each voxel with the attractor its pointer path ends in (Dupuy et al. 2019)."""
    offs = np.array([(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1) if (a, b, c) != (0, 0, 0)])
    unit = offs / np.linalg.norm(offs, axis=1)[:, None]
    best = np.argmax(v.reshape(3, -1).T @ unit.T, axis=1)
    idx = np.indices((N, N, N)).reshape(3, -1).T
    nxt = idx + offs[best]
    out = np.any((nxt < 0) | (nxt >= N), axis=1)
    lin = (np.clip(nxt[:, 0], 0, N - 1) * N + np.clip(nxt[:, 1], 0, N - 1)) * N + np.clip(nxt[:, 2], 0, N - 1)
    succ = np.where(out, np.arange(N**3), lin)  # paths leaving the box stop at its edge
    cur = np.arange(N**3)
    for _ in range(12):  # pointer doubling: 4096 steps, far longer than any path
        cur = succ[cur]
        succ = succ[succ]
    # Each path now sits in its final loop: name the loop by its smallest voxel.
    label = cur.copy()
    walk = cur.copy()
    step = np.where(out, np.arange(N**3), lin)
    for _ in range(64):
        walk = step[walk]
        label = np.minimum(label, walk)
    return label.reshape(N, N, N), step


def loop_centre(label_value, step):
    """The mean position of an attractor's loop (voxels)."""
    seen, p = [], label_value
    while p not in seen:
        seen.append(p)
        p = step[p]
    return np.mean([np.unravel_index(q, (N, N, N)) for q in seen], axis=0)


def unit_flow(v):
    def u(p):
        a = interp(v, p).T
        return a / (np.linalg.norm(a, axis=1)[:, None] + 1e-12)

    return u


def rk4(u, p):
    k1 = u(p)
    k2 = u(p + 0.5 * STEP * k1)
    k3 = u(p + 0.5 * STEP * k2)
    k4 = u(p + STEP * k3)
    return np.clip(p + STEP * (k1 + 2 * k2 + 2 * k3 + k4) / 6, 0, N - 1.001)


def basin_by_streamlines(v, attractor):
    """The voxels whose streamlines end at the attractor (voxel coordinates)."""
    grid = np.argwhere(np.ones((N, N, N), bool))
    start = grid[np.linalg.norm(grid - CENTRE, axis=1) * VOXEL <= BASIN_RADIUS]
    p = start.astype(float)
    u = unit_flow(v)
    for _ in range(BASIN_STEPS):
        p = rk4(u, p)
    mask = np.zeros((N, N, N), bool)
    arrived = np.linalg.norm(p - attractor, axis=1) * VOXEL < ARRIVED
    mask[tuple(start[arrived].T)] = True
    return mask


def interp(f, p):
    p = np.clip(p, 0, N - 1.001)
    i = np.floor(p).astype(int)
    t = p - i
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (t[:, 0] if dx else 1 - t[:, 0]) * (t[:, 1] if dy else 1 - t[:, 1]) * (t[:, 2] if dz else 1 - t[:, 2])
                out = out + w * f[..., i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz]
    return out


def streamlines(v, delta, inside):
    """Flow lines from seeds placed where the matter is, by fourth-order Runge–Kutta."""
    grid = np.argwhere(np.ones((N, N, N), bool))
    r = np.linalg.norm(grid - CENTRE, axis=1) * VOXEL
    near = grid[r < SEED_RADIUS]
    home = inside[near[:, 0], near[:, 1], near[:, 2]]
    chosen = []
    for cand, n in ((near[home], SEEDS_IN), (near[~home], SEEDS_OUT)):
        weight = np.clip(1 + delta[cand[:, 0], cand[:, 1], cand[:, 2]], 0, None) ** 1.5
        # More seeds than voxels: several per voxel, spread by the jitter below.
        chosen.append(cand[rng.choice(len(cand), n, replace=n > len(cand), p=weight / weight.sum())])
    picked = np.concatenate(chosen)
    seeds = picked + rng.uniform(-0.5, 0.5, (SEEDS, 3))
    flags = inside[picked[:, 0], picked[:, 1], picked[:, 2]]

    u = unit_flow(v)
    p = seeds.copy()
    track = [p.copy()]
    alive = np.ones(SEEDS, bool)
    stop = np.full(SEEDS, MAX_STEPS)
    for s in range(1, MAX_STEPS + 1):
        k1 = u(p)
        k2 = u(p + 0.5 * STEP * k1)
        k3 = u(p + 0.5 * STEP * k2)
        k4 = u(p + STEP * k3)
        p = p + STEP * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        left = np.any((p < 0) | (p > N - 1), axis=1)
        p = np.clip(p, 0, N - 1)
        track.append(p.copy())
        # Stopped: out of the box, or circling an attractor (no net progress over 24 steps).
        if s >= 24:
            stalled = np.linalg.norm(track[-1] - track[-25], axis=1) < 2.0
            ended = alive & (left | stalled)
            stop[ended] = s
            alive &= ~ended
        if not alive.any():
            break
    track = np.array(track)  # (steps + 1, SEEDS, 3)
    lines = []
    for k in range(SEEDS):
        pts = track[: stop[k] + 1 : 2, k]  # every voxel
        if len(pts) >= 4:
            lines.append((voxel_to_scene(pts), int(flags[k])))
    return lines


def surface(mask):
    """A smoothed surface-nets mesh of a voxel mask (vertices in voxel coordinates)."""
    k = np.fft.fftfreq(N)
    kx, ky, kz = np.meshgrid(k, k, k, indexing="ij")
    f = np.real(np.fft.ifftn(np.fft.fftn(mask.astype(float)) * np.exp(-2 * (math.pi * 1.1) ** 2 * (kx**2 + ky**2 + kz**2)))) - 0.5
    inside = f > 0
    corners = [(a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)]
    cube = np.stack([inside[a : N - 1 + a, b : N - 1 + b, c : N - 1 + c] for a, b, c in corners])
    active = cube.any(0) & ~cube.all(0)
    cells = np.argwhere(active)
    vid = -np.ones((N - 1,) * 3, int)
    vid[tuple(cells.T)] = np.arange(len(cells))
    # Vertex: the mean of the cell's edge crossings.
    edges = [(i, j) for i in range(8) for j in range(i + 1, 8) if sum(abs(x - y) for x, y in zip(corners[i], corners[j])) == 1]
    acc = np.zeros((len(cells), 3))
    cnt = np.zeros(len(cells))
    for i, j in edges:
        fi = f[tuple((cells + corners[i]).T)]
        fj = f[tuple((cells + corners[j]).T)]
        cross = (fi > 0) != (fj > 0)
        t = fi[cross] / (fi[cross] - fj[cross])
        pos = cells[cross] + np.array(corners[i]) + t[:, None] * (np.array(corners[j]) - np.array(corners[i]))
        acc[cross] += pos
        cnt[cross] += 1
    verts = acc / cnt[:, None]
    # Faces: a quad around every grid edge the surface crosses, from the four cells sharing it.
    tris = []
    for axis in range(3):
        a1, a2 = [x for x in range(3) if x != axis]
        sl0 = [slice(1, N - 1)] * 3
        sl1 = [slice(1, N - 1)] * 3
        sl0[axis] = slice(0, N - 1)
        sl1[axis] = slice(1, N)
        s0 = inside[tuple(sl0)]
        s1 = inside[tuple(sl1)]
        for e in np.argwhere(s0 != s1):
            base = e + np.array([0 if x == axis else 1 for x in range(3)])
            q = []
            for d1, d2 in ((0, 0), (1, 0), (1, 1), (0, 1)):
                c = base.copy()
                c[a1] -= d1
                c[a2] -= d2
                q.append(vid[tuple(c)])
            if min(q) < 0:
                continue
            if s0[tuple(e)]:
                q = q[::-1]
            tris += [(q[0], q[1], q[2]), (q[0], q[2], q[3])]
    tris = np.array(tris, np.int64)
    # Two passes of Laplacian smoothing.
    for _ in range(2):
        nb = np.zeros_like(verts)
        deg = np.zeros(len(verts))
        for a, b in ((0, 1), (1, 2), (2, 0)):
            np.add.at(nb, tris[:, a], verts[tris[:, b]])
            np.add.at(deg, tris[:, a], 1)
            np.add.at(nb, tris[:, b], verts[tris[:, a]])
            np.add.at(deg, tris[:, b], 1)
        verts = 0.5 * verts + 0.5 * nb / np.maximum(deg, 1)[:, None]
    return verts, tris


def q16(a):
    q = np.round(np.asarray(a) / UNIT)
    if np.abs(q).max() > 32767:
        raise SystemExit("a position is beyond the int16 range")
    return q.astype("<i2")


def main():
    v = read_fits(fetch("CF4_new_128-z008_velocity.fits"), (3, N, N, N))
    delta = read_fits(fetch("CF4_new_128-z008_delta.fits"), (N, N, N))
    label, step = basins(v)
    att_voxel = loop_centre(label[64, 64, 64], step)
    att_sg = (att_voxel - CENTRE) * VOXEL
    inside = basin_by_streamlines(v, att_voxel)
    volume = inside.sum() * VOXEL**3
    print(f"Laniakea: {inside.sum()} voxels, {volume / 1e6:.2f} × 10⁶ (h⁻¹ Mpc)³, attractor SG {att_sg.round(1)} h⁻¹ Mpc")
    lines = streamlines(v, delta, inside)
    verts, tris = surface(inside)
    print(f"{len(lines)} flow lines ({sum(f for _, f in lines)} in Laniakea), surface {len(verts)} vertices, {len(tris)} triangles")
    pts = np.concatenate([p for p, _ in lines])
    att = voxel_to_scene(att_voxel)
    bits = np.packbits(inside.reshape(-1), bitorder="little")
    head = b"LANI" + struct.pack("<I4f4I4f", 1, UNIT, *att, len(lines), len(pts), len(verts), len(tris), N, VOXEL, CENTRE, H)
    body = (
        np.array([len(p) for p, _ in lines], "<u2").tobytes()
        + np.array([f for _, f in lines], "u1").tobytes()
        + q16(pts).tobytes()
        + q16(voxel_to_scene(verts)).tobytes()
        + tris.astype("<u4").tobytes()
        + bits.tobytes()
    )
    OUT.write_bytes(head + body)
    print(f"wrote {OUT.relative_to(ROOT)} ({(len(head) + len(body)) / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
