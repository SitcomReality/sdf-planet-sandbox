export function makeEdit(kind, pos, size, quat, op, color = [0.78, 0.74, 0.66]) {
  const r = kind === 2
      ? size[0] + size[1]
      : Math.max(size[0], size[1], size[2]) * 1.05;
  return {
    kind,
    px: pos[0], py: pos[1], pz: pos[2],
    sx: size[0], sy: size[1], sz: size[2],
    qx: quat[0], qy: quat[1], qz: quat[2], qw: quat[3],
    op,
    cr: color[0], cg: color[1], cb: color[2],
    aabbMin: [pos[0] - r, pos[1] - r, pos[2] - r],
    aabbMax: [pos[0] + r, pos[1] + r, pos[2] + r],
  };
}

export function cullEditsToSphere(edits, cx, cy, cz, radius) {
  const r2 = radius * radius;
  const out = [];
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const dx = Math.max(e.aabbMin[0] - cx, 0, cx - e.aabbMax[0]);
    const dy = Math.max(e.aabbMin[1] - cy, 0, cy - e.aabbMax[1]);
    const dz = Math.max(e.aabbMin[2] - cz, 0, cz - e.aabbMax[2]);
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(e);
  }
  return out;
}