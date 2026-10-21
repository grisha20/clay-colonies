// Shared helpers for the Clayfolk surface: value noise and lake signed distance.
// Lake outlines come from the world's terrain (snapshot surface.terrain, set by WorldView).

// Up to 8 lakes flattened into one point list: lake i uses points
// [lake_start[i], lake_start[i] + lake_len[i]) and is skipped outside lake_box[i]
// (xy = min, zw = max, already padded for the shoreline band).
const int CF_MAX_LAKES = 8;
const int CF_MAX_LAKE_POINTS = 384;
uniform vec2 lake_points[384];
uniform int lake_start[8];
uniform int lake_len[8];
uniform vec4 lake_box[8];
uniform int lake_count = 0;

// Relief (shared/surfaceTerrain.ts heightAt): hills as vec4(x, y, radius, height),
// mountains flattened like lakes with a peak height each.
uniform vec4 hills[16];
uniform int hill_count = 0;
uniform vec2 mountain_points[256];
uniform int mountain_start[8];
uniform int mountain_len[8];
uniform vec4 mountain_box[8];
uniform float mountain_height[8];
uniform int mountain_count = 0;
const float CF_MOUNTAIN_FOOT = 5.0;

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

float cf_sd_lake(vec2 p, int lake) {
	float d = 1e9;
	float s = 1.0;
	int first = lake_start[lake];
	int n = lake_len[lake];
	for (int k = 0; k < n; k++) {
		int i = first + k;
		int j = first + ((k == 0) ? n - 1 : k - 1);
		vec2 vi = lake_points[i];
		vec2 vj = lake_points[j];
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
	for (int i = 0; i < lake_count; i++) {
		vec4 box = lake_box[i];
		if (p.x > box.x && p.x < box.z && p.y > box.y && p.y < box.w) {
			raw = min(raw, cf_sd_lake(p, i));
		}
	}
	float wobble = (cf_noise(p * 0.21) - 0.5) * 1.4 + (cf_noise(p * 0.9) - 0.5) * 0.35;
	return raw + 0.55 + wobble;
}

// Signed distance to mountain i (negative inside).
float cf_sd_mountain(vec2 p, int m) {
	float d = 1e9;
	float s = 1.0;
	int first = mountain_start[m];
	int n = mountain_len[m];
	for (int k = 0; k < n; k++) {
		int i = first + k;
		int j = first + ((k == 0) ? n - 1 : k - 1);
		vec2 vi = mountain_points[i];
		vec2 vj = mountain_points[j];
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

// Nearest mountain signed distance (1e9 when none is near).
float cf_mountain_distance(vec2 p) {
	float best = 1e9;
	for (int i = 0; i < mountain_count; i++) {
		vec4 box = mountain_box[i];
		if (p.x > box.x && p.x < box.z && p.y > box.y && p.y < box.w) {
			best = min(best, cf_sd_mountain(p, i));
		}
	}
	return best;
}

// Ground height: heightAt / SurfaceTerrain.height_at, except that inside a
// massif the ground stays low (t capped) so the rock meshes rise above it.
// Nobody walks there, so only the walkable foot slope must match exactly.
float cf_height(vec2 p) {
	float h = 0.0;
	for (int i = 0; i < hill_count; i++) {
		vec4 hill = hills[i];
		vec2 d = p - hill.xy;
		float d2 = dot(d, d) / (hill.z * hill.z);
		if (d2 < 1.0) {
			h += hill.w * (1.0 - d2) * (1.0 - d2);
		}
	}
	for (int i = 0; i < mountain_count; i++) {
		vec4 box = mountain_box[i];
		if (p.x > box.x && p.x < box.z && p.y > box.y && p.y < box.w) {
			float sd = cf_sd_mountain(p, i);
			float t = sd < 0.0 ? min(0.4, 0.25 - sd / 10.0) : max(0.0, 0.25 * (1.0 - sd / CF_MOUNTAIN_FOOT));
			h = max(h, mountain_height[i] * t * t * (3.0 - 2.0 * t));
		}
	}
	return h;
}
