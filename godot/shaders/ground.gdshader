shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

// Clayfolk surface ground: meadow grass, trampled camp clearings, building yards,
// worn trails from resident traffic, dug clay/stone pits and lake shores.

#include "res://shaders/surface_common.gdshaderinc"

uniform vec2 map_size = vec2(480.0, 480.0);
uniform vec4 camps[4];
uniform int camp_count = 0;
uniform vec4 yards[32];
uniform int yard_count = 0;
uniform vec4 digs[12];
uniform float dig_kinds[12];
uniform int dig_count = 0;
// Tribe land (shared/territory.ts): xy centre, z radius, w tribe (0 = A, 1 = B).
uniform vec4 lands[12];
uniform int land_count = 0;
uniform vec3 land_a : source_color = vec3(0.95, 0.78, 0.28);
uniform vec3 land_b : source_color = vec3(0.24, 0.55, 0.80);
uniform sampler2D trail_map : filter_linear, repeat_disable;
uniform sampler2D detail_normal : hint_normal, filter_linear_mipmap, repeat_enable;

uniform vec3 grass_dark : source_color = vec3(0.31, 0.43, 0.18);
uniform vec3 grass_light : source_color = vec3(0.46, 0.56, 0.25);
uniform vec3 grass_dry : source_color = vec3(0.64, 0.60, 0.34);
uniform vec3 sand_a : source_color = vec3(0.83, 0.68, 0.43);
uniform vec3 sand_b : source_color = vec3(0.74, 0.58, 0.36);
uniform vec3 wet_sand : source_color = vec3(0.55, 0.45, 0.32);
uniform vec3 lake_bed : source_color = vec3(0.18, 0.33, 0.32);
uniform vec3 clay_dug : source_color = vec3(0.64, 0.33, 0.21);
uniform vec3 stone_dug : source_color = vec3(0.56, 0.54, 0.50);

varying vec2 world_xz;

uniform float wetness = 0.0;
uniform float rain_time = 0.0;
uniform vec3 rock : source_color = vec3(0.52, 0.50, 0.46);
uniform vec3 scree : source_color = vec3(0.62, 0.58, 0.50);
uniform vec3 moss : source_color = vec3(0.36, 0.44, 0.24);

void vertex() {
	world_xz = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz;
	// Hills and mountain feet lift the meadow; the slope normal comes from the
	// same height function so lighting follows the relief.
	float h = cf_height(world_xz);
	VERTEX.y += h;
	float e = 1.0;
	float hx = cf_height(world_xz + vec2(e, 0.0));
	float hz = cf_height(world_xz + vec2(0.0, e));
	NORMAL = normalize(vec3(h - hx, e, h - hz));
}

void fragment() {
	vec2 p = world_xz;
	float n_large = cf_fbm(p * 0.035);
	float n_mid = cf_noise(p * 0.6);
	float n_fine = cf_noise(p * 2.7);

	vec3 grass = mix(grass_dark, grass_light, smoothstep(0.30, 0.72, n_large));
	grass = mix(grass, grass_dry, smoothstep(0.58, 0.78, cf_fbm(p * 0.018 + vec2(31.0, 7.0))) * 0.75);
	grass *= 0.88 + 0.22 * n_mid;
	grass *= 0.94 + 0.10 * n_fine;

	float dirt = 0.0;
	for (int i = 0; i < camp_count; i++) {
		vec4 c = camps[i];
		float d = length(p - c.xy) / c.z;
		dirt = max(dirt, 1.0 - smoothstep(0.72, 1.06, d + (n_mid - 0.5) * 0.32));
	}
	for (int i = 0; i < yard_count; i++) {
		vec4 y = yards[i];
		float d = length((p - y.xy) / y.zw);
		dirt = max(dirt, (1.0 - smoothstep(0.78, 1.18, d + (n_mid - 0.5) * 0.30)) * 0.9);
	}
	vec2 trail_uv = p / map_size;
	float trail = texture(trail_map, trail_uv).r;
	dirt = max(dirt, smoothstep(0.05, 0.55, trail + (n_fine - 0.5) * 0.12) * 0.85);
	// Natural bare patches keep the meadow from looking like carpet.
	dirt = max(dirt, smoothstep(0.69, 0.79, cf_fbm(p * 0.05 + vec2(7.0, 3.0))) * 0.55);

	vec3 sand = mix(sand_a, sand_b, n_mid) * (0.92 + 0.16 * n_fine);
	// Packed, sooty earth right around each hearth.
	float soot = 0.0;
	for (int i = 0; i < camp_count; i++) {
		float d = length((p - camps[i].xy) / vec2(1.0, 0.75));
		soot = max(soot, 1.0 - smoothstep(2.0, 6.5, d + (n_mid - 0.5) * 1.5));
	}
	sand = mix(sand, sand_b * 0.72, soot * 0.6);
	vec3 col = mix(grass, sand, dirt);
	float rough = 0.94;

	// Land border: the best margin of each tribe; the owner is the larger one.
	// A soft line where the owner's land ends (or meets the other tribe's).
	if (land_count > 0) {
		float ma = -1e5;
		float mb = -1e5;
		for (int i = 0; i < land_count; i++) {
			float m = lands[i].z - length(p - lands[i].xy);
			if (lands[i].w > 0.5) mb = max(mb, m); else ma = max(ma, m);
		}
		float own = max(ma, mb);
		if (own > -1.0) {
			float other = min(ma, mb);
			float edge = other > 0.0 ? min(own, (own - other) * 0.5) : own;
			vec3 tribe_col = ma >= mb ? land_a : land_b;
			float line = 1.0 - smoothstep(0.15, 0.75, abs(edge - 0.4));
			float dash = 0.75 + 0.25 * step(0.5, fract((p.x + p.y) * 0.35));
			float rim = (1.0 - smoothstep(0.0, 5.0, edge)) * step(0.0, edge);
			col = mix(col, tribe_col, clamp(line * 0.55 * dash + rim * 0.08, 0.0, 0.7));
		}
	}

	for (int i = 0; i < dig_count; i++) {
		vec4 g = digs[i];
		float d = length((p - g.xy) / g.zw);
		float m = 1.0 - smoothstep(0.86, 1.14, d + (n_mid - 0.5) * 0.28);
		vec3 dug = dig_kinds[i] > 0.5 ? stone_dug : clay_dug;
		dug *= 0.62 + 0.38 * smoothstep(0.0, 0.95, d);
		dug *= 0.9 + 0.2 * n_fine;
		col = mix(col, dug, m);
		rough = mix(rough, dig_kinds[i] > 0.5 ? 0.9 : 0.7, m);
	}

	// Rocky ground: scree at the foot of each massif, bare rock with moss inside.
	float md = cf_mountain_distance(p);
	if (md < 7.0) {
		float foot = 1.0 - smoothstep(0.0, 7.0 + n_mid * 2.0, md);
		vec3 stone_col = mix(scree, rock, smoothstep(-1.0, -4.0, md)) * (0.85 + 0.3 * n_fine);
		stone_col = mix(stone_col, moss, smoothstep(0.55, 0.8, cf_noise(p * 0.4)) * smoothstep(0.0, -3.0, md) * 0.6);
		col = mix(col, stone_col, foot);
		rough = mix(rough, 0.97, foot);
	}

	float ld = cf_lake_distance(p);
	float shore = 1.0 - smoothstep(0.0, 3.2 + n_mid * 1.6, ld);
	col = mix(col, mix(sand_a, sand_b, 0.35) * (0.95 + 0.1 * n_fine), shore * 0.92);
	float wet = 1.0 - smoothstep(0.0, 1.0, ld);
	col = mix(col, wet_sand, wet * 0.85);
	rough = mix(rough, 0.5, wet);
	if (ld < 0.0) {
		col = mix(wet_sand, lake_bed, smoothstep(0.0, 6.0, -ld));
	}

	// Rain: darker, glossy soil; puddles in low spots; rings where drops land.
	if (wetness > 0.01 && ld > 0.0) {
		float puddle = smoothstep(0.62, 0.72, cf_fbm(p * 0.09 + vec2(3.0, 11.0))) * dirt;
		col *= 1.0 - wetness * (0.22 + 0.18 * puddle);
		rough = mix(rough, mix(0.45, 0.12, puddle), wetness);
		float rings = cf_rain_rings(p, rain_time) * wetness * (0.35 + 0.65 * puddle);
		col += rings * 0.08;
	}

	// Beyond the playable map the meadow quietly darkens.
	vec2 outside = max(vec2(0.0), max(-p, p - map_size));
	float edge = clamp(length(outside) / 40.0, 0.0, 1.0);
	col *= 1.0 - edge * 0.45;

	ALBEDO = col;
	ROUGHNESS = rough;
	NORMAL_MAP = texture(detail_normal, p / 5.0).rgb;
	NORMAL_MAP_DEPTH = mix(0.35, 0.8, dirt);
}
