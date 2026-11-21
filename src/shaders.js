// GLSL-Shader der Galaxie. Einheiten im Schwarzes-Loch-Shader: Schwarzschild-Radius rs = 1.

const NOISE = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
`;

// ---------------------------------------------------------------------------------------------
// Schwarzes Loch: pro Pixel wird ein Lichtstrahl rückwärts von der Kamera durch das
// Schwarzschild-Feld verfolgt. Bahngleichung (Binet, als Kraftgesetz geschrieben):
//   d²x/dλ² = -3/2 · h² · x / r⁵   mit h = |x × v| (erhalten), rs = 1
// Das liefert Schatten (Einfangradius ≈ 2,6 rs), Photonenring und das über/unter den Schatten
// gebogene Bild der Rückseite der Scheibe.
// Die Scheibe ist dünnes, leuchtendes Gas (Dicke wächst nach außen) statt einer Fläche: pro
// Schritt wird die Gauß-Dichte senkrecht zur Scheibe analytisch über das Wegstück integriert
// (erf), sonst gäbe es bei flachem Blick Stufen. Das Plasma hat Fäden und Knoten, die nach
// Kepler differentiell rotieren (innen schneller), Doppler-Beaming und einen Farbverlauf von
// Orange (außen) zu Creme-Weiß (innen). Plasma und Säulenintegration nach
// github.com/williamwasen/second-brain-black-hole (src/accretion.js, MIT-Lizenz).
// ---------------------------------------------------------------------------------------------
export const BH_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const BH_FRAG = /* glsl */ `
uniform vec3 uCam;
uniform float uTime;
uniform float uRin;
uniform float uRout;
uniform float uRbound;
uniform float uRs;
uniform vec3 uAccent;
uniform float uAccentMix;
uniform float uBright;
uniform float uBeam;    // Stärke des Doppler-Beamings (1 = wie im Vorbild)
uniform vec3 uN;        // Normale der Scheibe (leicht gekippt)
uniform float uIgnite;  // 0..1: die Scheibe zündet beim Start von innen nach außen
varying vec3 vWorld;
${NOISE}

float vn(vec3 p) { return vnoise(p); }
float fbm3(vec3 p) { return 0.56 * vn(p) + 0.28 * vn(p * 2.03 + 7.1) + 0.16 * vn(p * 4.07 - 3.8); }

float erfA(float x) {
  float a = abs(x), t = 1.0 / (1.0 + 0.3275911 * a);
  float poly = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign(x) * (1.0 - poly * exp(-a * a));
}

// Leuchtendes Gas an Punkt p (Einheiten rs). dir = Laufrichtung des (rückwärts verfolgten) Strahls.
vec3 plasma(vec3 p, vec3 dir, out float dens) {
  vec3 bx = normalize(vec3(uN.y, -uN.x, 0.0));
  vec3 by = normalize(cross(uN, bx));
  float x = dot(p, bx), y = dot(p, by), r = length(vec2(x, y));
  float win = smoothstep(uRin * 0.95, uRin * 1.17, r) * (1.0 - smoothstep(uRout * 0.71, uRout * 1.07, r));
  // Zünden: eine helle Front läuft von innen nach außen, dahinter brennt die Scheibe
  float front = mix(uRin * 0.8, uRout * 1.25, uIgnite);
  float lit = smoothstep(front, front - 2.2, r);
  win *= lit;
  if (win < 0.0001) { dens = 0.0; return vec3(0.0); }
  float a = atan(y, x);
  // differentielle Rotation: innen ein Umlauf in ~20 s, außen deutlich langsamer
  float omega = 0.31 * pow(3.4 / r, 1.5);
  float ph = a - uTime * omega;
  float drift = r + uTime * 0.018;
  vec3 q = vec3(cos(ph), sin(ph), drift * 0.30);
  float flow = fbm3(q * vec3(4.0, 4.0, 5.0) + vec3(0.0, 0.0, uTime * 0.065));
  float detail = fbm3(vec3(cos(ph) * 13.0, sin(ph) * 13.0, drift * 2.7) + flow * 2.7 + uTime * 0.038);
  float fil = fbm3(vec3(cos(ph) * 5.0, sin(ph) * 5.0, drift * 3.8) + vec3(flow * 2.0, flow * 2.0, flow * 4.0));
  float lanes = pow(smoothstep(0.24, 0.80, fil), 3.0);
  float knots = pow(smoothstep(0.25, 0.88, detail), 2.0);
  float energy = (0.10 + lanes * 2.2 + knots * 2.8) * (0.30 + 1.1 * flow);
  energy *= 0.28 + 1.55 * vn(vec3(cos(ph) * 2.2, sin(ph) * 2.2, uTime * 0.13));
  float falloff = pow(3.8 / r, 3.0);
  dens = win * (0.22 + energy * 0.55);
  // Kepler-Geschwindigkeit, Doppler: die heranfliegende Seite ist heller und weißer
  vec3 vel = normalize(cross(uN, p)) * sqrt(0.5 / max(r - 1.0, 1.0));
  float dop = clamp(1.0 / (1.0 + uBeam * dot(vel, dir)), 0.65, 1.65);
  float heat = clamp(0.85 - (r - 3.0) * 0.075 + knots * 0.25, 0.0, 1.0);
  vec3 tint = mix(vec3(1.0, 0.27, 0.055), vec3(1.0, 0.80, 0.49), heat);
  tint = mix(tint, vec3(1.0, 0.95, 0.82), smoothstep(0.72, 1.0, heat) * 0.62);
  tint = mix(tint, tint * uAccent / max(max(uAccent.r, uAccent.g), max(uAccent.b, 0.001)), uAccentMix);
  float flare = 1.0 + 2.5 * exp(-pow((r - front + 1.1) / 1.3, 2.0)) * (1.0 - uIgnite);
  return tint * (3.8 * falloff * energy * win * pow(dop, 2.3) * flare);
}

// Einen Lichtstrahl verfolgen. Rückgabe: vorgemischte Farbe + Deckkraft (ohne Schatten).
vec4 trace(vec3 ro, vec3 rd) {
  float R = uRbound;
  // außerhalb der Hüllkugel geradlinig bis zur Kugel (dort ist die Ablenkung klein)
  float bq = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  if (c > 0.0) {
    float disc = bq * bq - c;
    if (disc <= 0.0 || bq > 0.0) return vec4(0.0);
    ro += rd * (-bq - sqrt(disc));
  }
  vec3 p = ro;
  vec3 v = rd;
  vec3 hv = cross(p, v);
  float h2 = dot(hv, hv);
  vec3 col = vec3(0.0);
  float T = 1.0;   // Durchlässigkeit des Gases
  for (int i = 0; i < 720; i++) {
    float r = length(p);
    // nahe der Photonensphäre (r = 1,5) feiner rechnen: dort kreisen Strahlen mehrfach ums Loch
    float dt = r < 3.0 ? max(0.022 * r, 0.012) : 0.045 * r;
    float r5 = r * r * r * r * r;
    vec3 acc = -1.5 * h2 * p / r5;
    vec3 pn = p + v * dt + 0.5 * acc * dt * dt;
    float rn = length(pn);
    float rn5 = rn * rn * rn * rn * rn;
    vec3 accn = -1.5 * h2 * pn / rn5;
    vec3 vn1 = v + 0.5 * (acc + accn) * dt;

    // Gas der Scheibe auf diesem Wegstück (Gauß-Säule senkrecht zur Scheibe, analytisch)
    float h0 = dot(p, uN), h1 = dot(pn, uN);
    float dh = h0 - h1;
    float across = clamp(h0 / (abs(dh) < 1e-5 ? 1e-5 : dh), 0.0, 1.0);
    vec3 sp = mix(p, pn, across);
    float dR = length(sp - uN * dot(sp, uN));
    float th = 0.075 + 0.009 * dR;
    if ((min(abs(h0), abs(h1)) < th * 3.0 || h0 * h1 < 0.0) && dR < uRout * 1.1) {
      float dens;
      vec3 L = plasma(sp, normalize(v), dens);
      float seg = length(pn - p);
      float adh = abs(dh);
      float column = adh > 1e-4
        ? abs(erfA(h1 / th) - erfA(h0 / th)) * 0.8862269 * seg / adh
        : exp(-pow((h0 + h1) * 0.5 / th, 2.0)) * seg / th;
      float optical = column * 0.22;
      col += T * L * optical;
      T *= exp(-dens * optical * 0.65);
    }

    p = pn;
    v = vn1;
    if (rn < 1.0) break;                             // hinter den Ereignishorizont gefallen
    if (rn > R * 1.01 && dot(p, v) > 0.0) break;     // entkommen
    if (T < 0.004) break;
  }
  // Schwaches Gas am Rand deckt kaum ab, sonst läge ein dunkler Saum über dem Nebel dahinter
  float lum = dot(col, vec3(0.30, 0.55, 0.15)) * uBright;
  return vec4(col, (1.0 - T) * clamp(lum * 2.5, 0.0, 1.0));
}
// Schatten: eingefangen wird jeder Strahl mit Stoßparameter b < 3·sqrt(3)/2 rs (≈ 2,598).
// b = |Kamera × Richtung| ist entlang der Geraden konstant -> schon vor dem Verfolgen bekannt.
const float B_CRIT = 2.598;

void main() {
  vec3 rd = normalize(vWorld / uRs - uCam);
  // Ableitungen zuerst (gleichförmiger Kontrollfluss), Pixelgröße in Richtung und in b
  vec3 dx = dFdx(rd);
  vec3 dy = dFdy(rd);
  float b0 = length(cross(uCam, rd));
  float fw = max(fwidth(b0), 1e-5);

  // Photonenring: Bilder der Scheibe, deren Licht ums Loch gelaufen ist, sind dünner als ein
  // Pixel. Dort mehrere Strahlen pro Pixel verfolgen und mitteln (Supersampling), sonst einer.
  // 4 bzw. 2 Strahlen reichen: 8/4 sah gleich aus (0,1 % der Pixel sichtbar anders), kostete aber
  // doppelt so viel GPU-Zeit. Diese Strahlen kreisen am längsten und bestimmen die Laufzeit.
  float near = abs(b0 - B_CRIT);
  int n = near < max(0.12, 3.0 * fw) ? 4 : (b0 > B_CRIT - 4.0 * fw && b0 < 3.35) ? 2 : 1;
  vec4 sum = vec4(0.0);
  for (int k = 0; k < 8; k++) {
    if (k >= n) break;
    // Punkte auf einer Spirale innerhalb des Pixels
    vec2 o = n == 1 ? vec2(0.0) : vec2(0.0);
    if (n > 1) {
      float a = float(k) * 2.39996 + 0.3;
      float rr = n == 4 ? 0.35 : 0.22 + 0.2 * float(k / 4);
      o = vec2(cos(a), sin(a)) * rr;
    }
    vec3 dir = normalize(rd + dx * o.x + dy * o.y);
    vec4 t = trace(uCam, dir);
    float b = length(cross(uCam, dir));
    float shadow = 1.0 - smoothstep(B_CRIT - fw * 0.5, B_CRIT + fw * 0.5, b);
    t.a += (1.0 - t.a) * shadow;
    sum += t;
  }
  vec4 res = sum / float(n);
  if (res.a < 0.003) discard;
  // Helligkeit begrenzen: weit über Weiß sieht man nicht, es würde nur den Bloom in den Schatten tragen
  gl_FragColor = vec4(min(res.rgb * uBright, vec3(3.0)), res.a);
}
`;

// ---------------------------------------------------------------------------------------------
// Himmel: dunkler Rauch/Nebel um die ganze Szene
// ---------------------------------------------------------------------------------------------
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
uniform vec3 uTint;
uniform float uTime;
uniform float uIntro;   // 0..1 beim Start
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  float n = fbm(d * 2.1 + vec3(0.0, uTime * 0.004, 0.0));
  float n2 = fbm(d * 5.5 + 7.0);
  float smoke = smoothstep(0.40, 0.88, n) * (0.55 + 0.7 * n2);
  float wisps = smoothstep(0.55, 0.95, fbm(d * 9.0 - 3.0)) * 0.35;
  vec3 gray = mix(vec3(0.026, 0.026, 0.028), uTint * 0.04, 0.22);
  vec3 col = vec3(0.006, 0.006, 0.008) + gray * (smoke + wisps * smoke) * uIntro;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Sterne (Notizen/Abschnitte): weiche Punkte mit Kern + Halo, Größe in Welteinheiten
// ---------------------------------------------------------------------------------------------
export const STAR_VERT = /* glsl */ `
// Start: Sterne erscheinen vom Loch nach außen (uReveal = Radius der Front in Welteinheiten)
uniform float uReveal;
float reveal(vec3 w) { return 1.0 - smoothstep(uReveal * 0.55, uReveal, length(w)); }
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aPhase;
uniform float uScale;
uniform float uTime;
uniform float uMinPx;
varying vec3 vColor;
varying float vAlpha;
// Tiefe: hinter der Schärfeebene (uFocus = Abstand Kamera -> Blickpunkt) gedämpfter,
// vor und hinter ihr zunehmend unscharf (wie bei einem Objektiv)
uniform float uFocus;
float depthFade(float depth) {
  return mix(1.0, 0.36, smoothstep(uFocus - 150.0, uFocus + 650.0, depth));
}
float depthBlur(float depth) {
  return 1.0 + 1.4 * smoothstep(220.0, 900.0, abs(depth - uFocus));
}
// Punkt als Gauß-Glocke: Breite sigma = px/6, aber mindestens 0,8 Pixel. Kleinere Punkte werden
// breiter und dafür schwächer (gleiche Lichtmenge). So hängt die Helligkeit nicht davon ab, wo der
// Punkt zwischen den Pixeln liegt -> kein Flackern aus der Ferne.
const float SIG_MIN = 0.8;
varying float vSig;
varying float vPS;
varying float vPx;
// blur > 1: Unschärfe (Tiefenschärfe) - breiter, gleiche Lichtmenge
float pointSetup(float px, float blur) {
  float sig = max(px / 6.0, SIG_MIN) * blur;
  vSig = sig;
  vPx = px;
  float ps = min(max(px * blur, sig * 7.0), 128.0);
  vPS = ps;
  gl_PointSize = ps;
  float k = min(px / 6.0 / SIG_MIN, 1.0);
  return k * k / (blur * blur);
}
// Gravitationslinse für Punkte (dünne Linse, Masse im Ursprung). Sterne hinter dem Loch erscheinen
// nach außen verschoben und tangential gestreckt (Bögen um den Schatten); im zweiten Durchgang
// (uSecondary = 1) das Gegenbild auf der anderen Seite. Einstein-Winkel θE = sqrt(2 rs (Ds-Dl)/(Ds Dl)),
// also dieselbe Masse wie im Strahlenverfolger der Scheibe. Die Flächenhelligkeit bleibt erhalten:
// gestreckte Bilder werden größer, nicht heller. (Idee nach second-brain-black-hole, eigene Umsetzung.)
uniform float uLensRs;     // Schwarzschild-Radius in Welteinheiten, 0 = aus
uniform float uSecondary;
// Linse für Punkte etwas stärker als die echte Masse, damit die Bögen in der Übersicht sichtbar werden
const float LENS_BOOST = 2.0;
varying vec2 vAxis;        // radiale Richtung im Sprite (gl_PointCoord, y nach unten)
varying vec2 vShape;       // Streckung radial / tangential
float lens(inout vec4 mv) {
  vAxis = vec2(1.0, 0.0);
  vShape = vec2(1.0);
  bool sec = uSecondary > 0.5;
  vec4 bh = viewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float Dl = -bh.z, Ds = -mv.z;
  if (uLensRs <= 0.0 || Dl < 1.0 || Ds <= Dl) return sec ? 0.0 : 1.0;
  vec2 al = bh.xy / Dl;
  vec2 d = mv.xy / Ds - al;
  float beta = length(d);
  float tE = sqrt(2.0 * LENS_BOOST * uLensRs * (Ds - Dl) / (Ds * Dl));
  float u = beta / max(tE, 1e-7);
  if (sec && u > 3.0) return 0.0;
  vec2 dir = beta > 1e-7 ? d / beta : vec2(1.0, 0.0);
  float root = sqrt(beta * beta + 4.0 * tE * tE);
  float th = 0.5 * (beta + (sec ? -root : root));
  // nur in der Nähe des Lochs: weiter weg (schwache Linse) bleiben Sterne, Linien und Klickpunkte
  // deckungsgleich, auch wenn das Loch dicht vor der Kamera liegt
  float w = sec ? 1.0 : 1.0 - smoothstep(3.0, 6.0, u);
  th = mix(beta, th, w);
  mv.xy = (al + dir * th) * Ds;
  vAxis = vec2(dir.x, -dir.y);
  vShape = mix(vec2(1.0), vec2(0.5 * abs(1.0 + (sec ? -beta : beta) / root), min(abs(th) / max(beta, 1e-7), 14.0)), w);
  // Bilder im Schatten (Einfangradius 2,6 rs) sieht man nicht
  float shadow = 2.598 * uLensRs / Dl;
  return smoothstep(shadow * 0.98, shadow * 1.12, abs(th)) * (sec ? smoothstep(3.0, 1.5, u) : 1.0);
}
// Sprite an die Streckung anpassen (nach pointSetup)
void lensSprite() {
  vPS = min(vPS * max(1.0, max(vShape.x, vShape.y)), 160.0);
  gl_PointSize = vPS;
}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float lensed = lens(mv);
  gl_Position = lensed > 0.0 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  float depth = -mv.z;
  float px = max(aSize * uScale / max(depth, 1.0), uMinPx * 0.6);
  vColor = aColor;
  vAlpha = aAlpha * pointSetup(px, depthBlur(depth)) * depthFade(depth) * reveal((modelMatrix * vec4(position, 1.0)).xyz) * lensed;
  lensSprite();
}
`;

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vSig;
varying float vPS;
varying float vPx;
varying vec2 vAxis;
varying vec2 vShape;
void main() {
  vec2 p = (gl_PointCoord * 2.0 - 1.0) * vPS * 0.5;           // Pixel ab der Mitte
  if (length(p) > vPS * 0.5) discard;
  // gelinste Bilder: radial gestaucht, tangential gestreckt; nie schmaler als ~1 Pixel
  // (dann entsprechend schwächer, gleiche Lichtmenge)
  vec2 sh = max(vShape, vec2(0.8 / max(vSig, 0.01)));
  vec2 q = vec2(dot(p, vAxis), dot(p, vec2(-vAxis.y, vAxis.x))) / sh;
  float rp = length(q);
  float core = exp(-rp * rp / (2.0 * vSig * vSig));
  float halo = exp(-rp / max(vPx * 0.22, 1.4)) * 0.5;
  float a = (core * 1.5 + halo) * vAlpha * (vShape.x / sh.x);
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

// Staub: Position wird im Shader aus Kepler-Bahn berechnet (ω = sqrt(GM/r³))
export const DUST_VERT = /* glsl */ `
// Start: Sterne erscheinen vom Loch nach außen (uReveal = Radius der Front in Welteinheiten)
uniform float uReveal;
float reveal(vec3 w) { return 1.0 - smoothstep(uReveal * 0.55, uReveal, length(w)); }
attribute float aR;
attribute float aA;
attribute float aH;
attribute float aSize;
attribute float aBright;
attribute vec3 aColor;
attribute float aCl;      // -1 = Hülle ums Loch, sonst Index des Clusters
uniform float uTime;
uniform float uGM;
uniform float uScale;
uniform vec3 uCenters[32];
varying vec3 vColor;
varying float vAlpha;
// Tiefe: hinter der Schärfeebene (uFocus = Abstand Kamera -> Blickpunkt) gedämpfter,
// vor und hinter ihr zunehmend unscharf (wie bei einem Objektiv)
uniform float uFocus;
float depthFade(float depth) {
  return mix(1.0, 0.36, smoothstep(uFocus - 150.0, uFocus + 650.0, depth));
}
float depthBlur(float depth) {
  return 1.0 + 1.4 * smoothstep(220.0, 900.0, abs(depth - uFocus));
}
// Punkt als Gauß-Glocke: Breite sigma = px/6, aber mindestens 0,8 Pixel. Kleinere Punkte werden
// breiter und dafür schwächer (gleiche Lichtmenge). So hängt die Helligkeit nicht davon ab, wo der
// Punkt zwischen den Pixeln liegt -> kein Flackern aus der Ferne.
const float SIG_MIN = 0.8;
varying float vSig;
varying float vPS;
varying float vPx;
// blur > 1: Unschärfe (Tiefenschärfe) - breiter, gleiche Lichtmenge
float pointSetup(float px, float blur) {
  float sig = max(px / 6.0, SIG_MIN) * blur;
  vSig = sig;
  vPx = px;
  float ps = min(max(px * blur, sig * 7.0), 128.0);
  vPS = ps;
  gl_PointSize = ps;
  float k = min(px / 6.0 / SIG_MIN, 1.0);
  return k * k / (blur * blur);
}
// Gravitationslinse für Punkte (dünne Linse, Masse im Ursprung). Sterne hinter dem Loch erscheinen
// nach außen verschoben und tangential gestreckt (Bögen um den Schatten); im zweiten Durchgang
// (uSecondary = 1) das Gegenbild auf der anderen Seite. Einstein-Winkel θE = sqrt(2 rs (Ds-Dl)/(Ds Dl)),
// also dieselbe Masse wie im Strahlenverfolger der Scheibe. Die Flächenhelligkeit bleibt erhalten:
// gestreckte Bilder werden größer, nicht heller. (Idee nach second-brain-black-hole, eigene Umsetzung.)
uniform float uLensRs;     // Schwarzschild-Radius in Welteinheiten, 0 = aus
uniform float uSecondary;
// Linse für Punkte etwas stärker als die echte Masse, damit die Bögen in der Übersicht sichtbar werden
const float LENS_BOOST = 2.0;
varying vec2 vAxis;        // radiale Richtung im Sprite (gl_PointCoord, y nach unten)
varying vec2 vShape;       // Streckung radial / tangential
float lens(inout vec4 mv) {
  vAxis = vec2(1.0, 0.0);
  vShape = vec2(1.0);
  bool sec = uSecondary > 0.5;
  vec4 bh = viewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float Dl = -bh.z, Ds = -mv.z;
  if (uLensRs <= 0.0 || Dl < 1.0 || Ds <= Dl) return sec ? 0.0 : 1.0;
  vec2 al = bh.xy / Dl;
  vec2 d = mv.xy / Ds - al;
  float beta = length(d);
  float tE = sqrt(2.0 * LENS_BOOST * uLensRs * (Ds - Dl) / (Ds * Dl));
  float u = beta / max(tE, 1e-7);
  if (sec && u > 3.0) return 0.0;
  vec2 dir = beta > 1e-7 ? d / beta : vec2(1.0, 0.0);
  float root = sqrt(beta * beta + 4.0 * tE * tE);
  float th = 0.5 * (beta + (sec ? -root : root));
  // nur in der Nähe des Lochs: weiter weg (schwache Linse) bleiben Sterne, Linien und Klickpunkte
  // deckungsgleich, auch wenn das Loch dicht vor der Kamera liegt
  float w = sec ? 1.0 : 1.0 - smoothstep(3.0, 6.0, u);
  th = mix(beta, th, w);
  mv.xy = (al + dir * th) * Ds;
  vAxis = vec2(dir.x, -dir.y);
  vShape = mix(vec2(1.0), vec2(0.5 * abs(1.0 + (sec ? -beta : beta) / root), min(abs(th) / max(beta, 1e-7), 14.0)), w);
  // Bilder im Schatten (Einfangradius 2,6 rs) sieht man nicht
  float shadow = 2.598 * uLensRs / Dl;
  return smoothstep(shadow * 0.98, shadow * 1.12, abs(th)) * (sec ? smoothstep(3.0, 1.5, u) : 1.0);
}
// Sprite an die Streckung anpassen (nach pointSetup)
void lensSprite() {
  vPS = min(vPS * max(1.0, max(vShape.x, vShape.y)), 160.0);
  gl_PointSize = vPS;
}
void main() {
  vec3 pos;
  float life = 1.0;
  if (aCl < -1.5) {
    // fällt auf einer Spirale ins Loch: der Radius schrumpft, der Umlauf wird schneller, die Bahn
    // legt sich dabei in die Ebene der Scheibe. Danach beginnt das Teilchen außen von vorn.
    float period = 46.0 + 34.0 * fract(aA * 7.13);
    float pr = fract(aA * 0.159155 + uTime / period);
    float rr = aR * (1.0 - 0.93 * pow(pr, 1.6));
    float ang = aA - uTime * sqrt(uGM / (aR * aR * aR)) - pr * (1.1 + 3.6 * pr) * 1.7;
    pos = vec3(cos(ang) * rr, aH * (1.0 - pr) * (1.0 - pr), sin(ang) * rr);
    life = smoothstep(0.0, 0.12, pr) * smoothstep(uLensRs * 3.2, uLensRs * 6.0, rr);
  } else if (aCl < 0.0) {
    // Kepler-Bahn ums schwarze Loch
    float om = sqrt(uGM / (aR * aR * aR));
    float ang = aA - om * uTime;
    pos = vec3(cos(ang) * aR, aH, sin(ang) * aR);
  } else {
    // Wolke um den Cluster: kreist langsam um dessen Mitte und wandert mit ihm
    float ang = aA - uTime * 0.12 / sqrt(aR + 8.0);
    pos = uCenters[int(aCl + 0.5)] + vec3(cos(ang) * aR, aH, sin(ang) * aR);
  }
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float lensed = lens(mv) * life;
  gl_Position = lensed > 0.0 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  float depth = -mv.z;
  float px = min(aSize * uScale / max(depth, 1.0), 7.0);
  vColor = aColor;
  vAlpha = aBright * 0.55 * max(pointSetup(px, depthBlur(depth)), 0.03) * depthFade(depth)
    * reveal((modelMatrix * vec4(pos, 1.0)).xyz) * lensed;
  lensSprite();
}
`;

// Ferne Hintergrundsterne: feste Pixelgröße
export const BG_VERT = /* glsl */ `
uniform float uIntro;
attribute float aSize;
attribute float aBright;
varying float vB;
// Punkt als Gauß-Glocke: Breite sigma = px/6, aber mindestens 0,8 Pixel. Kleinere Punkte werden
// breiter und dafür schwächer (gleiche Lichtmenge). So hängt die Helligkeit nicht davon ab, wo der
// Punkt zwischen den Pixeln liegt -> kein Flackern aus der Ferne.
const float SIG_MIN = 0.8;
varying float vSig;
varying float vPS;
varying float vPx;
// blur > 1: Unschärfe (Tiefenschärfe) - breiter, gleiche Lichtmenge
float pointSetup(float px, float blur) {
  float sig = max(px / 6.0, SIG_MIN) * blur;
  vSig = sig;
  vPx = px;
  float ps = min(max(px * blur, sig * 7.0), 128.0);
  vPS = ps;
  gl_PointSize = ps;
  float k = min(px / 6.0 / SIG_MIN, 1.0);
  return k * k / (blur * blur);
}
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vB = aBright * pointSetup(aSize, 1.0) * uIntro;
}
`;

export const BG_FRAG = /* glsl */ `
varying float vB;
varying float vSig;
varying float vPS;
varying float vPx;
void main() {
  float rp = length(gl_PointCoord * 2.0 - 1.0) * vPS * 0.5;
  if (rp > vPS * 0.5) discard;
  gl_FragColor = vec4(vec3(0.95, 0.95, 1.0) * exp(-rp * rp / (2.0 * vSig * vSig)) * vB, 1.0);
}
`;

// Verbindungen
export const LINE_VERT = /* glsl */ `
// Start: Sterne erscheinen vom Loch nach außen (uReveal = Radius der Front in Welteinheiten)
uniform float uReveal;
float reveal(vec3 w) { return 1.0 - smoothstep(uReveal * 0.55, uReveal, length(w)); }
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vC;
varying float vA;
// Tiefe: hinter der Schärfeebene (uFocus = Abstand Kamera -> Blickpunkt) gedämpfter,
// vor und hinter ihr zunehmend unscharf (wie bei einem Objektiv)
uniform float uFocus;
float depthFade(float depth) {
  return mix(1.0, 0.36, smoothstep(uFocus - 150.0, uFocus + 650.0, depth));
}
float depthBlur(float depth) {
  return 1.0 + 1.4 * smoothstep(220.0, 900.0, abs(depth - uFocus));
}
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vC = aColor;
  vA = aAlpha * depthFade(-mv.z) * reveal((modelMatrix * vec4(position, 1.0)).xyz);
}
`;

export const LINE_FRAG = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  gl_FragColor = vec4(vC * vA, 1.0);
}
`;

// Kometen: Schweif = Bahnstück hinter dem Kopf. aM = mittlere Anomalie des Bahnpunkts,
// dadurch ist der Schweif zeitlich gleich lang und am Perizentrum (schneller) räumlich länger.
export const COMET_VERT = /* glsl */ `
attribute float aM;
uniform float uM;
varying float vA;
void main() {
  float d = mod(uM - aM + 12.566370, 6.283185);
  vA = exp(-d * 1.5) * (1.0 - smoothstep(3.0, 5.0, d));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const COMET_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBright;
uniform float uIntro;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor * vA * uBright * uIntro, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Nebel um die Cluster: viele weiche, sich überlagernde Rauchschichten (zur Kamera gedreht) in
// verschiedenen Tiefen. Sie sitzen dort, wo die Sterne des Clusters liegen, drehen mit der Kugel
// mit (uRotY) und wirbeln langsam in sich. Nahe an der Kamera blenden sie weich aus.
// ---------------------------------------------------------------------------------------------
export const NEB_VERT = /* glsl */ `
// Start: Sterne erscheinen vom Loch nach außen (uReveal = Radius der Front in Welteinheiten)
uniform float uReveal;
float reveal(vec3 w) { return 1.0 - smoothstep(uReveal * 0.55, uReveal, length(w)); }
attribute vec3 aOff;
attribute float aCl;
attribute float aSize;
attribute float aRot;
attribute float aSpin;
attribute float aTex;
attribute float aAlpha;
uniform vec3 uCenters[32];
uniform vec3 uColors[32];
uniform float uTime;
uniform float uRotY;
uniform float uFocus;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vTex;
void main() {
  // Versatz mit der Kugel um die Hochachse drehen (gleiche Richtung wie in der Physik)
  float c = cos(uRotY), s = sin(uRotY);
  vec3 off = vec3(aOff.x * c + aOff.z * s, aOff.y, aOff.z * c - aOff.x * s);
  int k = int(aCl + 0.5);
  vec4 mv = modelViewMatrix * vec4(uCenters[k] + off, 1.0);
  // Schichten, die in Blickrichtung vor dem schwarzen Loch liegen, ausblenden: sonst legt sich
  // grauer Dunst über den Schatten
  vec4 bh = viewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float inFront = step(bh.z, mv.z);
  float lat = length(mv.xy / max(-mv.z, 1.0) - bh.xy / max(-bh.z, 1.0));
  float clear = mix(1.0, smoothstep(0.05, 0.28, lat), inFront);
  float a = aRot + uTime * aSpin;
  vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * position.xy * aSize;
  mv.xy += q;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vCol = uColors[k];
  vTex = aTex;
  float depth = -mv.z;
  vA = aAlpha * clear * reveal((modelMatrix * vec4(uCenters[k] + off, 1.0)).xyz * 1.3) * smoothstep(40.0, aSize * 1.2 + 80.0, depth) * mix(1.0, 0.5, smoothstep(uFocus - 100.0, uFocus + 700.0, depth));
}
`;

export const NEB_FRAG = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
varying float vTex;
void main() {
  vec2 cell = vec2(mod(vTex, 2.0), floor(vTex / 2.0)) * 0.5;
  float n = texture2D(uTex, cell + clamp(vUv, 0.004, 0.996) * 0.5).r;
  float a = n * vA;
  if (a < 0.0015) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;
