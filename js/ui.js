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
      playOverlay: document.getElementById("click-to-play"),
      qMenu: document.getElementById("q-menu"),
      btnSave: document.getElementById("btn-save"),
      btnLoad: document.getElementById("btn-load"),
      btnClear: document.getElementById("btn-clear"),
      toggleSpectrum: document.getElementById("toggle-spectrum"),
      colorSliders: document.getElementById("color-sliders"),
      sliderR: document.getElementById("slider-r"),
      sliderG: document.getElementById("slider-g"),
      sliderB: document.getElementById("slider-b"),
      sliderDimX: document.getElementById("slider-dim-x"),
      sliderDimY: document.getElementById("slider-dim-y"),
      sliderDimZ: document.getElementById("slider-dim-z"),
      sliderSmoothing: document.getElementById("slider-smoothing"),
      sliderNoiseStr: document.getElementById("slider-noise-str"),
      sliderNoiseScale: document.getElementById("slider-noise-scale")
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

    // Q Menu handlers
    this.elements.btnSave.onclick = () => this.engine.saveToStorage();
    this.elements.btnLoad.onclick = () => this.engine.loadFromStorage();
    this.elements.btnClear.onclick = () => {
      if (confirm("Clear all edits?")) this.engine.clearScene();
    };
    
    this.elements.toggleSpectrum.onchange = (e) => {
      this.engine.spectrumMode = e.target.checked;
      this.elements.colorSliders.classList.toggle("hidden", e.target.checked);
    };

    const updateCustomColor = () => {
      this.engine.customColor = [
        parseInt(this.elements.sliderR.value) / 255,
        parseInt(this.elements.sliderG.value) / 255,
        parseInt(this.elements.sliderB.value) / 255
      ];
    };
    this.elements.sliderR.oninput = updateCustomColor;
    this.elements.sliderG.oninput = updateCustomColor;
    this.elements.sliderB.oninput = updateCustomColor;

    // Shape dimension controls
    this.elements.sliderDimX.oninput = () => {
      this.engine.shapeSize[0] = parseFloat(this.elements.sliderDimX.value);
      this.engine.markDirty();
    };
    this.elements.sliderDimY.oninput = () => {
      this.engine.shapeSize[1] = parseFloat(this.elements.sliderDimY.value);
      this.engine.markDirty();
    };
    this.elements.sliderDimZ.oninput = () => {
      this.engine.shapeSize[2] = parseFloat(this.elements.sliderDimZ.value);
      this.engine.markDirty();
    };

    // Blending & terrain controls
    this.elements.sliderSmoothing.oninput = () => {
      this.engine.smoothing = parseFloat(this.elements.sliderSmoothing.value);
      this.engine.markDirty();
    };
    this.elements.sliderNoiseStr.oninput = () => {
      this.engine.noiseStrength = parseFloat(this.elements.sliderNoiseStr.value);
      this.engine.markDirty();
    };
    this.elements.sliderNoiseScale.oninput = () => {
      this.engine.noiseScale = parseFloat(this.elements.sliderNoiseScale.value);
      this.engine.markDirty();
    };
  }

  updateProgress(label, frac) {
    this.elements.label.textContent = label;
    this.elements.fill.style.width = `${frac * 100}%`;
    if (frac >= 1) {
      setTimeout(() => {
        this.elements.screen.classList.add("hidden");
        // Only show play overlay if pointer isn't already locked
        if (!document.pointerLockElement) {
          this.setPlayOverlay(true);
        }
      }, 500);
    }
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
    
    // Update dimension sliders to match
    this.elements.sliderDimX.value = this.engine.shapeSize[0];
    this.elements.sliderDimY.value = this.engine.shapeSize[1];
    this.elements.sliderDimZ.value = this.engine.shapeSize[2];
    
    Array.from(this.elements.actionBar.children).forEach((btn, i) => {
      btn.classList.toggle("active", i === kind);
    });
    this.engine.markDirty();
  }

  setPlayOverlay(visible) {
    this.elements.playOverlay.classList.toggle("hidden", !visible);
  }

  setQMenu(visible) {
    this.elements.qMenu.classList.toggle("hidden", !visible);
  }
}