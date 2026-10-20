// Shared helpers for the Clayfolk surface: value noise and lake signed distance.
// Lake outlines are the authored polygons from shared/surfaceTerrain.ts (set by WorldView).

uniform vec2 north_lake[48];
uniform int north_lake_count = 0;
uniform vec2 south_lake[48];
uniform int south_lake_count = 0;

// Integer lattice hash. A float fract() hash is chaotic enough that compiler
// FMA contraction changes corner values between neighbouring cells, which shows
// up as hard square blotches; integer arithmetic is exact.
float cf_hash(vec2 p) {
	uvec2 q = uvec2(ivec2(floor(p)) + ivec2(65536));
	q *= uvec2(1597334673u, 3812015801u);
	uint n = (q.x ^ q.y) * 1597334673u;
	n ^= n >> 15u;
	return float(n) * (1.0 / 4294967295.0);
}

float cf_noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = cf_hash(i);
	float b = cf_hash(i + vec2(1.0, 0.0));
	float c = cf_hash(i + vec2(0.0, 1.0));
	float d = cf_hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cf_fbm(vec2 p) {
	float v = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 4; i++) {
		v += amp * cf_noise(p);
		p = p * 2.03 + vec2(17.1, 9.7);
		amp *= 0.5;
	}
	return v;
}

float cf_sd_north(vec2 p) {
	float d = 1e9;
	float s = 1.0;
	int n = north_lake_count;
	for (int i = 0; i < n; i++) {
		int j = (i == 0) ? n - 1 : i - 1;
		vec2 vi = north_lake[i];
		vec2 vj = north_lake[j];
		vec2 e = vj - vi;
		vec2 w = p - vi;
		vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
		d = min(d, dot(b, b));
		bool c1 = p.y >= vi.y;
		bool c2 = p.y < vj.y;
		bool c3 = e.x * w.y > e.y * w.x;
		if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) {
			s = -s;
		}
	}
	return s * sqrt(d);
}

float cf_sd_south(vec2 p) {
	float d = 1e9;
	float s = 1.0;
	int n = south_lake_count;
	for (int i = 0; i < n; i++) {
		int j = (i == 0) ? n - 1 : i - 1;
		vec2 vi = south_lake[i];
		vec2 vj = south_lake[j];
		vec2 e = vj - vi;
		vec2 w = p - vi;
		vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
		d = min(d, dot(b, b));
		bool c1 = p.y >= vi.y;
		bool c2 = p.y < vj.y;
		bool c3 = e.x * w.y > e.y * w.x;
		if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) {
			s = -s;
		}
	}
	return s * sqrt(d);
}

// Negative inside water. Sharp authored corners are softened with a small noisy
// inward offset so the shoreline reads as a pond instead of a pixel staircase.
float cf_lake_distance(vec2 p) {
	float raw = 1e9;
	// Cheap bounding test: only evaluate polygons near their boxes.
	if (p.x > 160.0 && p.x < 304.0 && p.y > 84.0 && p.y < 196.0) {
		raw = min(raw, cf_sd_north(p));
	}
	if (p.x > 144.0 && p.x < 336.0 && p.y > 292.0 && p.y < 452.0) {
		raw = min(raw, cf_sd_south(p));
	}
	float wobble = (cf_noise(p * 0.21) - 0.5) * 1.4 + (cf_noise(p * 0.9) - 0.5) * 0.35;
	return raw + 0.55 + wobble;
}
