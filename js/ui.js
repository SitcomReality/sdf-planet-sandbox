export const SHAPES = [
  { kind: 0, name: "Sphere",   key: "1", icon: "●" },
  { kind: 1, name: "Cube",     key: "2", icon: "■" },
  { kind: 2, name: "Torus",    key: "3", icon: "◯" },
  { kind: 3, name: "Cylinder", key: "4", icon: "▮" },
];

export class Hud {
  constructor(engine) {
    this.engine = engine;
    this.elements = {
      label: document.getElementById("loading-label"),
      fill: document.getElementById("progress-fill"),
      screen: document.getElementById("loading-screen"),
      fps: document.getElementById("fps-counter"),
      edits: document.getElementById("edit-counter"),
      quality: document.getElementById("quality-select"),
      actionBar: document.getElementById("action-bar"),
      playOverlay: document.getElementById("click-to-play")
    };
    this.init();
  }

  init() {
    SHAPES.forEach(s => {
      const btn = document.createElement("button");
      btn.className = `shape-btn ${s.kind === 0 ? "active" : ""}`;
      btn.innerHTML = `<span class="shape-icon">${s.icon}</span><span class="shape-name">${s.name}</span>`;
      btn.onclick = (e) => {
          e.stopPropagation();
          this.selectShape(s.kind);
      };
      this.elements.actionBar.appendChild(btn);
    });

    this.elements.quality.onchange = (e) => {
      this.engine.renderScale = parseFloat(e.target.value);
      this.engine.markDirty();
    };
  }

  updateProgress(label, frac) {
    this.elements.label.textContent = label;
    this.elements.fill.style.width = `${frac * 100}%`;
    if (frac >= 1) setTimeout(() => this.elements.screen.classList.add("hidden"), 500);
  }

  updateStats(fps, edits) {
    this.elements.fps.textContent = Math.round(fps);
    this.elements.edits.textContent = edits;
  }

  selectShape(kind) {
    this.engine.selectedShape = kind;
    if (kind === 0) this.engine.shapeSize = [0.6, 0.6, 0.6];
    else if (kind === 1) this.engine.shapeSize = [0.5, 0.5, 0.5];
    else if (kind === 2) this.engine.shapeSize = [0.6, 0.18, 0.0];
    else this.engine.shapeSize = [0.4, 0.6, 0.0];
    
    Array.from(this.elements.actionBar.children).forEach((btn, i) => {
      btn.classList.toggle("active", i === kind);
    });
    this.engine.markDirty();
  }

  setPlayOverlay(visible) {
    this.elements.playOverlay.classList.toggle("hidden", !visible);
  }
}