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

void vertex() {
	world_xz = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz;
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

	float ld = cf_lake_distance(p);
	float shore = 1.0 - smoothstep(0.0, 3.2 + n_mid * 1.6, ld);
	col = mix(col, mix(sand_a, sand_b, 0.35) * (0.95 + 0.1 * n_fine), shore * 0.92);
	float wet = 1.0 - smoothstep(0.0, 1.0, ld);
	col = mix(col, wet_sand, wet * 0.85);
	rough = mix(rough, 0.5, wet);
	if (ld < 0.0) {
		col = mix(wet_sand, lake_bed, smoothstep(0.0, 6.0, -ld));
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
