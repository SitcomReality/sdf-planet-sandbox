import { VERT_SRC, FRAG_SRC } from "./shaders.js";
import { makeEdit, cullEditsToSphere } from "./bvh.js";
import { quatIdentity, quatMul, quatFromAxisAngle, hsvToRgb } from "./math.js";

const MAX_EDITS_TOTAL = 256;
const MAX_EDITS_GPU = 96;
const EDIT_TEX_WIDTH = 64;
const PLANET_RADIUS = 6.0;
const WORLD_RADIUS = PLANET_RADIUS + 3.0;
const CULL_RADIUS = 30.0;

export class SdfEngine {
  constructor(canvas, callbacks = {}) {
    this.callbacks = callbacks;
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.editsData = new Float32Array(EDIT_TEX_WIDTH * EDIT_TEX_WIDTH * 4);
    this.dirty = true;
    this.renderScale = 0.5;
    this.edits = [];
    this.player = { lon: 0, lat: 0.3, altitude: 3.5, yaw: 0, pitch: -0.4 };
    this.selectedShape = 0;
    this.shapeSize = [0.6, 0.6, 0.6];
    this.ghostDistance = 3.0;
    this.ghostUserQuat = quatIdentity();
    this.ghostSubtractMode = false;
    this.hueCursor = 0.0;
    this.hueStep = 0.07;
    this.initGL();
    this.seedTerrain();
  }

  initGL() {
    const gl = this.gl;
    this.prog = this.compile(VERT_SRC, FRAG_SRC);
    gl.useProgram(this.prog);
    this.uniforms = {};
    ["uResolution", "uCamPos", "uCamRot", "uFovScale", "uPlanetRadius", "uWorldRadius", "uEdits", "uEditCount", "uEditTexWidth", "uTime", "uSunDir", "uGhostKind", "uGhostPos", "uGhostSize", "uGhostQuat", "uGhostOp"]
    .forEach(n => this.uniforms[n] = gl.getUniformLocation(this.prog, n));
    this.vao = gl.createVertexArray();
    this.editsTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.editsTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, EDIT_TEX_WIDTH, EDIT_TEX_WIDTH, 0, gl.RGBA, gl.FLOAT, this.editsData);
    this.fbo = gl.createFramebuffer();
    this.fboTex = gl.createTexture();
    const blitVert = `#version 300 es\nprecision highp float; out vec2 vUv; void main(){ vec2 p = vec2((gl_VertexID==1)?3.0:-1.0,(gl_VertexID==2)?3.0:-1.0); vUv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }`;
    const blitFrag = `#version 300 es\nprecision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uTex; void main(){ o = texture(uTex, vUv); }`;
    this.blitProg = this.compile(blitVert, blitFrag);
    this.blitUniformTex = gl.getUniformLocation(this.blitProg, "uTex");
  }

  compile(vs, fs) {
    const gl = this.gl;
    const s = (t, src) => {
      const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const p = gl.createProgram(); gl.attachShader(p, s(gl.VERTEX_SHADER, vs)); gl.attachShader(p, s(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  seedTerrain() {
    this.callbacks.onLoadingProgress?.("Seeding planet...", 0.5);
    for (let i = 0; i < 12; i++) {
      const lon = i * 1.5, lat = Math.sin(i) * 0.8, r = PLANET_RADIUS + 0.1;
      const cl = Math.cos(lat);
      this.edits.push(makeEdit(0, [Math.cos(lon)*cl*r, Math.sin(lat)*r, Math.sin(lon)*cl*r], [0.3, 0.3, 0.3], quatIdentity(), 1));
    }
    this.callbacks.onLoadingProgress?.("Ready", 1.0);
    this.markDirty();
  }

  markDirty() { this.dirty = true; }

  performAction(subtract) {
    const pos = this.ghostWorldPos(), quat = this.ghostWorldQuat();
    const color = subtract ? [0.78, 0.74, 0.66] : hsvToRgb(this.hueCursor, 0.85, 0.95);
    this.edits.push(makeEdit(this.selectedShape, pos, this.shapeSize.slice(), quat, subtract ? -1 : 1, color));
    if (this.edits.length > MAX_EDITS_TOTAL) this.edits.shift();
    this.hueCursor = (this.hueCursor + this.hueStep) % 1.0;
    this.markDirty();
    return true;
  }

  ghostWorldPos() {
    const cam = this.cameraPosition(), fwd = this.cameraForward();
    return [cam[0] + fwd[0] * this.ghostDistance, cam[1] + fwd[1] * this.ghostDistance, cam[2] + fwd[2] * this.ghostDistance];
  }

  ghostWorldQuat() { return quatMul(this.cameraQuat(), this.ghostUserQuat); }

  cameraQuat() {
    const b = this.cameraBasis(), m = [b.right, b.up, b.fwd].flat();
    const tr = m[0] + m[4] + m[8];
    let q;
    if (tr > 0) { const s = Math.sqrt(tr + 1.0) * 2; q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, 0.25 * s]; }
    else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1.0 + m[0] - m[4] - m[8]) * 2; q = [0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]; }
    else if (m[4] > m[8]) { const s = Math.sqrt(1.0 + m[4] - m[0] - m[8]) * 2; q = [(m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s, (m[2] - m[6]) / s]; }
    else { const s = Math.sqrt(1.0 + m[8] - m[0] - m[4]) * 2; q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s, (m[3] - m[1]) / s]; }
    const l = Math.hypot(...q); return q.map(v => v/l);
  }

  cameraPosition() {
    const r = PLANET_RADIUS + this.player.altitude, { lon, lat } = this.player, cl = Math.cos(lat);
    return [Math.cos(lon) * cl * r, Math.sin(lat) * r, Math.sin(lon) * cl * r];
  }

  cameraBasis() {
    const p = this.cameraPosition(), l = Math.hypot(...p), upR = p.map(v => v/l);
    let ref = [0, 1, 0]; if (Math.abs(upR[1]) > 0.9) ref = [0, 0, 1];
    const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
    const east = cross(upR, ref), el = Math.hypot(...east), e = east.map(v => v/el);
    const north = cross(e, upR);
    const cy = Math.cos(this.player.yaw), sy = Math.sin(this.player.yaw), cp = Math.cos(this.player.pitch), sp = Math.sin(this.player.pitch);
    const h = [north[0]*cy+e[0]*sy, north[1]*cy+e[1]*sy, north[2]*cy+e[2]*sy];
    const fwd = [h[0]*cp+upR[0]*sp, h[1]*cp+upR[1]*sp, h[2]*cp+upR[2]*sp];
    const right = cross(fwd, upR), rl = Math.hypot(...right), r = right.map(v => v/rl);
    return { right: r, up: cross(r, fwd), fwd };
  }

  cameraForward() { return this.cameraBasis().fwd; }

  move(f, s, u, dt) {
    if (f || s) {
      const b = this.cameraBasis(), p = this.cameraPosition(), l = Math.hypot(...p), up = p.map(v => v/l);
      const proj = v => { const d = v[0]*up[0]+v[1]*up[1]+v[2]*up[2]; return [v[0]-up[0]*d, v[1]-up[1]*d, v[2]-up[2]*d]; };
      const ft = proj(b.fwd), rt = proj(b.right), ftl = Math.hypot(...ft), rtl = Math.hypot(...rt);
      const mv = [ (ft[0]/ftl)*f + (rt[0]/rtl)*s, (ft[1]/ftl)*f + (rt[1]/rtl)*s, (ft[2]/ftl)*f + (rt[2]/rtl)*s ];
      const mvl = Math.hypot(...mv), r = PLANET_RADIUS + this.player.altitude, ang = (2.5 * dt) / r;
      const np = [ p[0] + (mv[0]/mvl)*ang*r, p[1] + (mv[1]/mvl)*ang*r, p[2] + (mv[2]/mvl)*ang*r ];
      const nl = Math.hypot(...np);
      this.player.lat = Math.asin(Math.max(-1, Math.min(1, np[1]/nl)));
      this.player.lon = Math.atan2(np[2]/nl, np[0]/nl);
      this.markDirty();
    }
    if (u) { this.player.altitude = Math.max(0.5, Math.min(8, this.player.altitude + u * 3 * dt)); this.markDirty(); }
  }

  look(dx, dy) { this.player.yaw -= dx * 0.0025; this.player.pitch = Math.max(-1.4, Math.min(1.4, this.player.pitch - dy * 0.0025)); this.markDirty(); }

  rotateGhost(dx, dy) {
    this.ghostUserQuat = quatMul(quatMul(quatFromAxisAngle(0, 1, 0, -dx*0.01), quatFromAxisAngle(1, 0, 0, -dy*0.01)), this.ghostUserQuat);
    const l = Math.hypot(...this.ghostUserQuat); this.ghostUserQuat = this.ghostUserQuat.map(v => v/l);
    this.markDirty();
  }

  renderIfDirty(time) { if (!this.dirty) return false; this.dirty = false; this.render(time); return true; }

  render(time) {
    const gl = this.gl, canv = gl.canvas, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const fw = Math.floor(canv.clientWidth * dpr), fh = Math.floor(canv.clientHeight * dpr);
    if (canv.width !== fw || canv.height !== fh) { canv.width = fw; canv.height = fh; }
    const lw = Math.floor(fw * this.renderScale), lh = Math.floor(fh * this.renderScale);
    if (this.fboW !== lw || this.fboH !== lh) {
      this.fboW = lw; this.fboH = lh; gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
    }
    const cam = this.cameraPosition(), visible = cullEditsToSphere(this.edits, ...cam, CULL_RADIUS).slice(-MAX_EDITS_GPU + 1);
    this.editsData.fill(0);
    visible.forEach((e, i) => {
      const o = i * 16;
      [e.px, e.py, e.pz, e.kind].forEach((v, j) => this.editsData[o + j] = v);
      [e.sx, e.sy, e.sz, e.op].forEach((v, j) => this.editsData[o + 4 + j] = v);
      [e.qx, e.qy, e.qz, e.qw].forEach((v, j) => this.editsData[o + 8 + j] = v);
      [0, e.cr, e.cg, e.cb].forEach((v, j) => this.editsData[o + 12 + j] = v);
    });
    gl.bindTexture(gl.TEXTURE_2D, this.editsTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, EDIT_TEX_WIDTH, EDIT_TEX_WIDTH, gl.RGBA, gl.FLOAT, this.editsData);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, lw, lh); gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.uniform2f(this.uniforms.uResolution, lw, lh); gl.uniform3fv(this.uniforms.uCamPos, cam);
    const b = this.cameraBasis(); gl.uniformMatrix3fv(this.uniforms.uCamRot, false, [b.right, b.up, b.fwd.map(v => -v)].flat());
    gl.uniform1f(this.uniforms.uFovScale, Math.tan(30 * Math.PI / 180)); gl.uniform1f(this.uniforms.uPlanetRadius, PLANET_RADIUS);
    gl.uniform1f(this.uniforms.uWorldRadius, WORLD_RADIUS); gl.uniform1i(this.uniforms.uEditCount, visible.length);
    gl.uniform1i(this.uniforms.uEditTexWidth, EDIT_TEX_WIDTH); gl.uniform1f(this.uniforms.uTime, time * 0.001);
    gl.uniform3f(this.uniforms.uSunDir, 0.5, 0.7, 0.5); gl.uniform1i(this.uniforms.uGhostKind, this.selectedShape);
    gl.uniform3fv(this.uniforms.uGhostPos, this.ghostWorldPos()); gl.uniform3fv(this.uniforms.uGhostSize, this.shapeSize);
    gl.uniform4fv(this.uniforms.uGhostQuat, this.ghostWorldQuat()); gl.uniform1f(this.uniforms.uGhostOp, this.ghostSubtractMode ? -1 : 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.editsTex); gl.uniform1i(this.uniforms.uEdits, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, fw, fh); gl.useProgram(this.blitProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.fboTex); gl.uniform1i(this.blitUniformTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}