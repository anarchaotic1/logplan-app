/** The supernova background: one fragment shader. Everything is computed in linear light and then compressed so
 *  that no pixel can exceed LUMA_CAP (relative luminance). That ceiling is what keeps text readable wherever it
 *  scrolls: tests/contrast.test.ts checks text colours against a background pixel at the cap. */
export const LUMA_CAP = 0.034;
export const MAX_PULSES = 4;
export const PULSE_LIFE = 1.6;

export const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

export const FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;      // canvas size in pixels
uniform float u_t;       // seconds
uniform float u_level;   // 0..1, today's completion
uniform vec3 u_acc;      // accent colour, linear
uniform vec3 u_bg;       // page background, linear
uniform vec2 u_core;     // core position in pixels (origin top-left)
uniform vec4 u_pulse[${MAX_PULSES}]; // x, y, start time, active
out vec4 o;
const float PI = 3.14159265;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = .5, s = 0.; for(int i=0;i<3;i++){ s += a*noise(p); p = p*2.03 + vec2(17., 9.); a *= .5; } return s; }
void main(){
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  float S = min(u_res.x, u_res.y);
  // Rings started by a completion: each expands from the check that was tapped and bends the field for 0.6 s.
  vec2 q = px; float tap = 0.;
  for(int i=0;i<${MAX_PULSES};i++){
    float age = u_t - u_pulse[i].z;
    if(u_pulse[i].w < .5 || age < 0. || age > ${PULSE_LIFE.toFixed(1)}) continue;
    vec2 d = px - u_pulse[i].xy; float r = length(d);
    float front = (1. - exp(-age*2.2)) * S * 1.15;
    float fade = 1. - age/${PULSE_LIFE.toFixed(1)};
    if(age < .6) q += normalize(d + 1e-4) * exp(-pow((r-front)/(S*.05), 2.)) * S*.02 * (1. - age/.6);
    tap += exp(-pow((r-front)/(S*.006), 2.)) * fade * fade;
  }
  vec2 d = (q - u_core)/S; float r = length(d); vec2 dir = d/max(r, 1e-4);
  float lvl = .4 + .6*u_level;
  float core = exp(-r*r*2600.);
  float bloom = exp(-r*9.)*.5 + exp(-r*3.4)*.06;
  // Filaments: ridged noise in a shell around the core, drifting very slowly outward.
  float n = fbm(dir*2.6 + vec2(r*3.4 - u_t*.012, u_t*.008));
  float fil = pow(1. - abs(2.*n - 1.), 6.) * smoothstep(.07, .24, r) * (1. - smoothstep(.4, .95, r));
  // Ambient shock rings: a new one every 12 s, each alive for 24 s.
  float ring = 0.;
  for(int j=0;j<2;j++){
    float age = mod(u_t + float(j)*12., 24.);
    float rr = .03 + age/24.*1.2;
    ring += exp(-pow((r-rr)/.0032, 2.)) * pow(1. - age/24., 1.6) * smoothstep(0., 1.2, age);
  }
  // Debris: one fine particle in each of 40 angular sectors, drifting radially.
  float deb = 0.; float ai = (atan(d.y, d.x) + PI)/(2.*PI)*40.;
  for(int k=-1;k<=1;k++){
    float idx = mod(floor(ai) + float(k), 40.);
    float h1 = hash(vec2(idx, 1.)), h2 = hash(vec2(idx, 2.));
    float ang = (idx + .2 + .6*h1)/40.*2.*PI - PI;
    float rad = .06 + fract(h2 + u_t*(.003 + .005*h1))*1.15;
    vec2 pp = vec2(cos(ang), sin(ang))*rad;
    float dd = length(d - pp);
    deb += exp(-dd*dd*42000.) * (1. - smoothstep(.55, 1.2, rad)) * smoothstep(.06, .2, rad) * (.4 + .6*h1);
  }
  vec3 col = u_bg
    + u_acc * (bloom*lvl*.085 + fil*lvl*.03 + ring*.03 + tap*.11)
    + vec3(1.) * (core*lvl*.2 + deb*.035 + tap*.03 + ring*.006);
  float L = dot(col, vec3(.2126, .7152, .0722));
  col *= 1./(1. + L/${LUMA_CAP}); // soft ceiling: luminance approaches the cap but never reaches it
  col = pow(col, vec3(1./2.2)) + (hash(px + u_t) - .5)/255.; // display gamma, plus dither against banding
  o = vec4(col, 1.);
}`;

/** '#RRGGBB' to linear RGB (0..1). */
export function hexToLinear(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 0.7, 0.36];
  return [0, 2, 4].map((i) => { const s = parseInt(m[1].slice(i, i + 2), 16) / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
}
