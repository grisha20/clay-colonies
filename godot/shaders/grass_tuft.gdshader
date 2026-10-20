shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_disabled;

// Meadow tufts, reeds and flowers scattered by GroundDecor. UV.y is 0 at the root
// and 1 at the tip; only tips sway. INSTANCE_CUSTOM.rgb tints flower heads, .a scales blade brightness.

uniform float wind_strength = 0.12;
uniform float wind_speed = 1.3;

varying vec4 custom;

void vertex() {
	vec3 world = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float phase = world.x * 0.21 + world.z * 0.17;
	float sway = sin(TIME * wind_speed + phase) * 0.7 + sin(TIME * wind_speed * 2.3 + phase * 1.7) * 0.3;
	float w = UV.y * UV.y;
	VERTEX.x += sway * wind_strength * w;
	VERTEX.z += sway * wind_strength * 0.5 * w;
	// Soft, view-independent lighting: blades are lit like the ground they grow from.
	NORMAL = normalize(mix(NORMAL, vec3(0.0, 1.0, 0.0), 0.75));
	custom = INSTANCE_CUSTOM;
}

void fragment() {
	// Vertex alpha 1: keep the authored blade colour (scaled by custom.a);
	// alpha 0: flower heads take the per-instance tint.
	// Vertex and instance colours are authored in sRGB.
	vec3 srgb = clamp(mix(custom.rgb, COLOR.rgb * custom.a, clamp(COLOR.a, 0.0, 1.0)), vec3(0.0), vec3(1.0));
	vec3 base = srgb * srgb;
	ALBEDO = base;
	ROUGHNESS = 0.9;
}
