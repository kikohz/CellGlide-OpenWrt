# Makes the flat traffic map's countries (htdocs/luci-static/resources/cellglide/world.json)
# from Natural Earth's 1:50m countries (public domain): each outer ring simplified
# (Douglas–Peucker), in tenths of a degree, delta-encoded as one string of numbers per ring.
# Antarctica and specks under half a degree are left out.
#   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson
#   python3 scripts/world-outlines.py ne_50m_admin_0_countries.geojson 0.15 htdocs/luci-static/resources/cellglide/world.json
import json, sys
src, tolerance, out = sys.argv[1], float(sys.argv[2]), sys.argv[3]
data = json.load(open(src))

def simplify(points, eps):
    if len(points) < 3: return points
    keep = [False] * len(points); keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = points[a], points[b]
        dx, dy = x2 - x1, y2 - y1; norm = (dx * dx + dy * dy) ** 0.5
        best, at = 0, None
        for i in range(a + 1, b):
            x, y = points[i]
            d = abs(dy * (x - x1) - dx * (y - y1)) / norm if norm else ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
            if d > best: best, at = d, i
        if at is not None and best > eps:
            keep[at] = True; stack += [(a, at), (at, b)]
    return [p for p, k in zip(points, keep) if k]

rings, points = [], 0
for f in data['features']:
    if f['properties'].get('ADM0_A3') == 'ATA': continue
    g = f['geometry']
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for poly in polys:
        ring = poly[0]
        # Specks smaller than a dot at this size are left out.
        xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
        if (max(xs) - min(xs)) < 0.5 and (max(ys) - min(ys)) < 0.5: continue
        s = simplify(ring, tolerance)
        if len(s) < 4: continue
        q = [(round(x * 10), round(y * 10)) for x, y in s]
        enc, px, py = [], 0, 0
        for x, y in q:
            enc += [x - px, y - py]; px, py = x, y
        rings.append(' '.join(map(str, enc))); points += len(q)
text = json.dumps(rings, separators=(',', ':'))
open(out, 'w').write(text)
print(src.split('/')[-1], 'tolerance', tolerance, 'rings', len(rings), 'points', points, 'bytes', len(text))
