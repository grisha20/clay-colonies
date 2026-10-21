shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

// Pond water over the authored lake polygons: shallow rim, darker depth,
// slow ripples and a soft foam line. Fully transparent outside the lakes.

#include "res://shaders/surface_common.gdshaderinc"

uniform vec3 shallow : source_color = vec3(0.36, 0.62, 0.62);
uniform vec3 deep : source_color = vec3(0.12, 0.32, 0.42);
uniform vec3 foam : source_color = vec3(0.92, 0.94, 0.86);
uniform float speed_scale = 1.0;
uniform float rain = 0.0;

varying vec2 world_xz;

void vertex() {
	world_xz = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz;
}

void fragment() {
	vec2 p = world_xz;
	float ld = cf_lake_distance(p);
	if (ld > 0.25) {
		discard;
	}
	float depth = smoothstep(0.0, 7.0, -ld);
	float t = TIME * 0.35 * speed_scale;
	// Rotated, layered lattices hide the value-noise grid that otherwise shows
	// up as little squares on a calm surface.
	vec2 q1 = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8)) * p;
	vec2 q2 = mat2(vec2(0.28, -0.96), vec2(0.96, 0.28)) * p;
	float r1 = 0.6 * cf_noise(q1 * 0.32 + vec2(t, t * 0.6)) + 0.4 * cf_noise(q2 * 0.5 - vec2(t * 0.5, t * 0.3));
	float r2 = 0.6 * cf_noise(q2 * 0.75 - vec2(t * 0.8, -t * 0.4)) + 0.4 * cf_noise(q1 * 1.1 + vec2(t * 0.3, t * 0.7));
	vec3 col = mix(shallow, deep, depth);
	col += (r1 * r2 - 0.25) * 0.08;
	// Rain stipples the surface with spreading rings and dulls it.
	float drops = rain > 0.01 ? cf_rain_rings(p * 1.6, TIME) * rain : 0.0;
	col = mix(col, col * 0.85 + vec3(0.04, 0.05, 0.06), rain * 0.5);
	col += drops * 0.25;
	r1 += drops * 0.6;
	float foam_band = (1.0 - smoothstep(0.0, 0.7 + r1 * 0.5, -ld)) * (0.55 + 0.45 * r2);
	col = mix(col, foam, foam_band * 0.65);
	ALBEDO = col;
	ALPHA = clamp(mix(0.55, 0.9, depth) + foam_band * 0.3, 0.0, 1.0) * (1.0 - smoothstep(0.0, 0.25, ld));
	ROUGHNESS = 0.08;
	METALLIC = 0.0;
	SPECULAR = 0.6;
	vec2 slope = vec2(r1 - 0.5, r2 - 0.5) * 0.35;
	NORMAL = normalize((VIEW_MATRIX * vec4(slope.x, 1.0, slope.y, 0.0)).xyz);
}
