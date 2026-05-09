export const VERT_SRC = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform vec2  uResolution;
uniform vec3  uCamPos;
uniform mat3  uCamRot;
uniform float uFovScale;
uniform float uPlanetRadius;
uniform float uWorldRadius;
uniform sampler2D uEdits;
uniform int   uEditCount;
uniform int   uEditTexWidth;
uniform float uTime;
uniform vec3  uSunDir;

uniform int   uGhostKind;
uniform vec3  uGhostPos;
uniform vec3  uGhostSize;
uniform vec4  uGhostQuat;
uniform float uGhostOp;

const int   MAX_STEPS      = 40;
const float DIST_THRESHOLD = 0.003;
const float MIN_STEP       = 0.0008;

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float smax(float a, float b, float k) {
  float h = clamp(0.5 - 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) + k * h * (1.0 - h);
}

vec3 qRotInv(vec4 q, vec3 v) {
  vec3 u = vec3(-q.x, -q.y, -q.z);
  return v + 2.0 * cross(u, cross(u, v) + q.w * v);
}

float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdTorus(vec3 p, float R, float r) {
  vec2 q = vec2(length(p.xz) - R, p.y);
  return length(q) - r;
}
float sdCylinder(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float terrainNoise(vec3 p) {
  vec3 n = normalize(p + 1e-5);
  float a = sin(n.x * 4.0 + n.y * 5.3) * cos(n.z * 4.7);
  float b = sin(n.x * 11.0) * sin(n.y * 9.7) * sin(n.z * 10.3);
  return a * 0.18 + b * 0.06;
}

float sdPlanet(vec3 p) {
  return length(p) - (uPlanetRadius + terrainNoise(p));
}

void fetchEdit(int i, out vec4 a, out vec4 b, out vec4 c, out vec4 d) {
  int base = i * 4;
  int w = uEditTexWidth;
  ivec2 p0 = ivec2(base % w, base / w);
  ivec2 p1 = ivec2((base+1) % w, (base+1) / w);
  ivec2 p2 = ivec2((base+2) % w, (base+2) / w);
  ivec2 p3 = ivec2((base+3) % w, (base+3) / w);
  a = texelFetch(uEdits, p0, 0);
  b = texelFetch(uEdits, p1, 0);
  c = texelFetch(uEdits, p2, 0);
  d = texelFetch(uEdits, p3, 0);
}

vec3 planetColorBase(vec3 p) {
  float h = length(p) - uPlanetRadius;
  return mix(vec3(0.42, 0.55, 0.25), vec3(0.55, 0.45, 0.30), clamp(h * 4.0 + 0.5, 0.0, 1.0));
}

struct Scene {
  float d;
  vec3 col;
  float w;
};

Scene mapSceneFull(vec3 p) {
  float d = sdPlanet(p);
  vec3  col = planetColorBase(p);
  float planetW = 1.0;
  const float K_ADD = 0.15;
  const float K_SUB = 0.20;
  for (int i = 0; i < 96; i++) {
    if (i >= uEditCount) break;
    vec4 a, b, c, dd; fetchEdit(i, a, b, c, dd);
    vec3 pos = a.xyz; int kind = int(a.w + 0.5);
    vec3 size = b.xyz; float op = b.w;
    vec4 q = c; vec3 editCol = dd.yzw;
    vec3 lp = qRotInv(q, p - pos);
    float ed;
    if (kind == 0) ed = sdSphere(lp, size.x);
    else if (kind == 1) ed = sdBox(lp, size);
    else if (kind == 2) ed = sdTorus(lp, size.x, size.y);
    else ed = sdCylinder(lp, size.x, size.y);

    if (op > 0.0) {
      float k = K_ADD; float h = clamp(0.5 + 0.5 * (ed - d) / k, 0.0, 1.0);
      d = mix(ed, d, h) - k * h * (1.0 - h);
      col = mix(editCol, col, h);
      planetW *= h;
    } else {
      float k = K_SUB; float a2 = d, b2 = -ed;
      float h2 = clamp(0.5 + 0.5 * (a2 - b2) / k, 0.0, 1.0);
      d = mix(b2, a2, h2) + k * h2 * (1.0 - h2);
    }
  }
  return Scene(d, col, planetW);
}

float mapGhost(vec3 p) {
  if (uGhostKind < 0) return 1e9;
  vec3 lp = qRotInv(uGhostQuat, p - uGhostPos);
  if (uGhostKind == 0) return sdSphere(lp, uGhostSize.x);
  else if (uGhostKind == 1) return sdBox(lp, uGhostSize);
  else if (uGhostKind == 2) return sdTorus(lp, uGhostSize.x, uGhostSize.y);
  else return sdCylinder(lp, uGhostSize.x, uGhostSize.y);
}

float mapAll(vec3 p) {
  float ds = mapSceneFull(p).d;
  float dg = mapGhost(p);
  return min(ds, dg);
}
vec3 calcNormal(vec3 p) {
  const float h = 0.01;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mapAll(p + k.xyy * h) +
    k.yyx * mapAll(p + k.yyx * h) +
    k.yxy * mapAll(p + k.yxy * h) +
    k.xxx * mapAll(p + k.xxx * h));
}

vec2 raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd); float c = dot(ro, ro) - R * R;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h); return vec2(-b - h, -b + h);
}

void main() {
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uResolution.x / uResolution.y;
  vec3 rd = normalize(uCamRot * vec3(uv * uFovScale, -1.0));
  vec3 ro = uCamPos;
  vec2 hit = raySphere(ro, rd, uWorldRadius);
  if (hit.y < 0.0) {
    vec3 sky = mix(vec3(0.55, 0.72, 0.95), vec3(0.18, 0.32, 0.62), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
    sky += vec3(1.0, 0.95, 0.85) * smoothstep(0.997, 0.9995, dot(rd, uSunDir));
    fragColor = vec4(sky, 1.0); return;
  }
  float t = max(hit.x, 0.0);
  if (uGhostKind >= 0) t = 0.0;
  float tMax = hit.y + 1.0;
  bool hitSurface = false;
  vec3 p;
  for (int i = 0; i < MAX_STEPS; i++) {
    p = ro + rd * t;
    float d = mapAll(p);
    if (d < DIST_THRESHOLD) { hitSurface = true; break; }
    t += max(d, MIN_STEP);
    if (t > tMax) break;
  }
  if (!hitSurface) {
    vec3 sky = mix(vec3(0.55, 0.72, 0.95), vec3(0.18, 0.32, 0.62), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
    sky += vec3(1.0, 0.95, 0.85) * smoothstep(0.997, 0.9995, dot(rd, uSunDir));
    fragColor = vec4(sky, 1.0); return;
  }
  vec3 n = calcNormal(p);
  Scene sceneRes = mapSceneFull(p);
  float dGhost = mapGhost(p);
  bool isGhost = dGhost < sceneRes.d;
  vec3 base;
  if (isGhost) {
    float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
    base = (uGhostOp > 0.0) ? mix(vec3(0.3, 0.85, 1.0), vec3(0.65, 1.0, 1.0), pulse) : mix(vec3(1.0, 0.35, 0.35), vec3(1.0, 0.65, 0.55), pulse);
  } else {
    base = sceneRes.col;
    float steep = 1.0 - clamp(dot(n, normalize(p)), 0.0, 1.0);
    base = mix(base, vec3(0.45, 0.42, 0.40), smoothstep(0.4, 0.8, steep) * sceneRes.w);
  }
  float diff = max(dot(n, uSunDir), 0.0);
  float amb = 0.35 + 0.25 * (n.y * 0.5 + 0.5);
  vec3 col = base * (amb + diff * 0.7);
  vec3 sky = mix(vec3(0.55, 0.72, 0.95), vec3(0.18, 0.32, 0.62), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
  fragColor = vec4(mix(col, sky, 1.0 - exp(-t * 0.012)), 1.0);
}`;