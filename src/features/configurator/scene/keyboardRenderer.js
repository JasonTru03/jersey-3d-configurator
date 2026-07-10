import gsap from 'gsap';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const KEY_HEIGHT = 0.22;
const KEY_GAP = 0.14;
const KEY_UNIT = 0.72;
const WIDE_KEYS = {
  Bksp: 1.8,
  Tab: 1.35,
  Caps: 1.55,
  Enter: 1.8,
  Shift: 2.1,
  Ctrl: 1.2,
  Alt: 1.2,
  Space: 5.3,
};

export class KeyboardRenderer {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f3f1ec');
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.camera.position.set(5.4, 4.8, 7.8);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('contextmenu', preventContextMenu);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 12;
    this.controls.minPolarAngle = Math.PI * 0.16;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.55;
    this.controls.panSpeed = 0.7;
    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.root = new THREE.Group();
    this.caseGroup = new THREE.Group();
    this.keyGroup = new THREE.Group();
    this.extraGroup = new THREE.Group();
    this.glowGroup = new THREE.Group();
    this.root.add(this.caseGroup, this.keyGroup, this.extraGroup, this.glowGroup);
    this.scene.add(this.root);

    this.materials = {
      case: new THREE.MeshPhysicalMaterial({ color: '#f0eee8', roughness: 0.45, metalness: 0.02, clearcoat: 0.6 }),
      key: new THREE.MeshStandardMaterial({ color: '#f8f5ed', roughness: 0.34, metalness: 0.04 }),
      accent: new THREE.MeshStandardMaterial({ color: '#24262b', roughness: 0.38, metalness: 0.08 }),
      glow: new THREE.MeshBasicMaterial({ color: '#f0b16e', transparent: true, opacity: 0.22 }),
      legend: new THREE.SpriteMaterial({ color: '#2e3138', transparent: true, opacity: 0.78 }),
    };

    this.currentLayout = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.addLights();
    this.addFloor();
    this.resize();
    this.animate();
  }

  update(product, state, selected) {
    if (!selected) return;
    this.product = product;
    this.state = state;
    this.selected = selected;

    this.applyMaterial(selected);
    this.applyColors(selected.colorway.swatches);

    if (this.currentLayout !== state.layout) {
      this.currentLayout = state.layout;
      this.rebuildBoard(selected.layout);
    }

    this.updateExtras();
    this.updateLighting();
  }

  setView(view) {
    const targets = {
      orbit: { x: 5.4, y: 4.8, z: 7.8 },
      top: { x: 0.1, y: 8.2, z: 0.1 },
      detail: { x: 2.8, y: 2.3, z: 3.2 },
    };
    const target = targets[view] ?? targets.orbit;
    gsap.to(this.camera.position, {
      ...target,
      duration: 0.55,
      ease: 'power2.out',
      onUpdate: () => this.camera.lookAt(0, 0, 0),
    });
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.domElement.removeEventListener('contextmenu', preventContextMenu);
    this.disposeGroup(this.root);
    Object.values(this.materials).forEach((material) => material.dispose());
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  addLights() {
    const hemi = new THREE.HemisphereLight('#ffffff', '#6c665e', 2.1);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#fff8ed', 3);
    key.position.set(4, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#9bc8ff', 1.2);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
  }

  addFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(6.5, 72),
      new THREE.MeshStandardMaterial({ color: '#dedbd4', roughness: 0.72, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.34;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  rebuildBoard(layout) {
    this.disposeGroup(this.caseGroup);
    this.disposeGroup(this.keyGroup);
    this.disposeGroup(this.extraGroup);
    this.disposeGroup(this.glowGroup);
    this.caseGroup.clear();
    this.keyGroup.clear();
    this.extraGroup.clear();
    this.glowGroup.clear();

    const rows = layout.rows.map((row) => row.split(' '));
    const metrics = this.measureRows(rows);
    const caseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(metrics.width + 0.68, 0.34, metrics.depth + 0.78, 8, 1, 8),
      this.materials.case,
    );
    caseMesh.position.y = -0.09;
    caseMesh.castShadow = true;
    caseMesh.receiveShadow = true;
    this.caseGroup.add(caseMesh);

    rows.forEach((row, rowIndex) => {
      let cursor = -metrics.width / 2;
      const z = -metrics.depth / 2 + rowIndex * (KEY_UNIT + KEY_GAP) + 0.46;
      row.forEach((label, colIndex) => {
        const width = (WIDE_KEYS[label] ?? 1) * KEY_UNIT;
        const x = cursor + width / 2;
        const isAccent = ['Esc', 'Enter', 'Space', 'Up', 'Down', 'Left', 'Right'].includes(label);
        const cap = this.makeKeycap(width, KEY_UNIT, label, isAccent);
        cap.position.set(x, KEY_HEIGHT, z);
        cap.userData.baseY = KEY_HEIGHT;
        cap.userData.row = rowIndex;
        cap.userData.col = colIndex;
        this.keyGroup.add(cap);

        const glow = new THREE.Mesh(
          new THREE.BoxGeometry(width * 0.86, 0.02, KEY_UNIT * 0.7),
          this.materials.glow,
        );
        glow.position.set(x, 0.035, z);
        this.glowGroup.add(glow);
        cursor += width + KEY_GAP;
      });
    });

    this.centerRoot(metrics);
    this.popKeys();
    this.updateExtras();
    this.updateLighting();
  }

  makeKeycap(width, depth, label, isAccent) {
    const group = new THREE.Group();
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(width, KEY_HEIGHT, depth, 4, 1, 4),
      isAccent ? this.materials.accent : this.materials.key,
    );
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    const legend = new THREE.Sprite(makeLabelMaterial(label, isAccent ? '#f7f2ea' : '#2e3138'));
    legend.scale.set(Math.min(width * 0.58, 0.72), 0.22, 1);
    legend.position.set(0, 0.16, 0.01);
    group.add(legend);

    return group;
  }

  measureRows(rows) {
    const width = Math.max(
      ...rows.map((row) =>
        row.reduce((sum, label) => sum + (WIDE_KEYS[label] ?? 1) * KEY_UNIT + KEY_GAP, -KEY_GAP),
      ),
    );
    return {
      width,
      depth: rows.length * (KEY_UNIT + KEY_GAP) - KEY_GAP + 0.5,
    };
  }

  centerRoot(metrics) {
    this.root.position.set(0, 0, -metrics.depth * 0.05);
    this.controls.target.set(0, 0.1, 0);
  }

  updateExtras() {
    if (!this.selected || !this.state) return;
    const hasKnob = Boolean(this.state.extras.knob);
    if (hasKnob && !this.knob) {
      const knob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.36, 0.3, 48),
        new THREE.MeshStandardMaterial({ color: '#303035', roughness: 0.24, metalness: 0.78 }),
      );
      knob.position.set(3.35, 0.28, -2.15);
      knob.castShadow = true;
      this.knob = knob;
      this.extraGroup.add(knob);
    }
    if (!hasKnob && this.knob) {
      this.extraGroup.remove(this.knob);
      this.knob.geometry.dispose();
      this.knob.material.dispose();
      this.knob = null;
    }
  }

  updateLighting() {
    const on = this.state?.lighting !== 'off';
    this.glowGroup.visible = on;
    this.materials.glow.opacity = this.state?.lighting === 'reactive' ? 0.38 : 0.22;
  }

  applyColors(swatches) {
    tweenColor(this.materials.case, swatches.case);
    tweenColor(this.materials.key, swatches.key);
    tweenColor(this.materials.accent, swatches.accent);
    tweenColor(this.materials.glow, swatches.light);
    this.scene.background.set(swatches.case).lerp(new THREE.Color('#f6f4ef'), 0.78);
  }

  applyMaterial(selected) {
    const material = selected.material.material;
    if ('clearcoat' in this.materials.case) {
      this.materials.case.clearcoat = material.clearcoat;
    }
    gsap.to(this.materials.case, {
      roughness: material.roughness,
      metalness: material.metalness,
      duration: 0.45,
      ease: 'power2.out',
    });
  }

  popKeys() {
    this.keyGroup.children.forEach((key) => {
      gsap.fromTo(
        key.position,
        { y: key.userData.baseY + 0.48 },
        {
          y: key.userData.baseY,
          duration: 0.55,
          delay: key.userData.row * 0.025 + key.userData.col * 0.004,
          ease: 'power3.out',
          overwrite: 'auto',
        },
      );
    });
  }

  resize() {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  disposeGroup(group) {
    group.traverse((item) => {
      if (item.geometry) item.geometry.dispose();
      if (item.material && !Object.values(this.materials).includes(item.material)) {
        if (Array.isArray(item.material)) {
          item.material.forEach((material) => material.dispose());
        } else {
          item.material.dispose();
        }
      }
      if (item.material?.map) item.material.map.dispose();
    });
  }
}

function preventContextMenu(event) {
  event.preventDefault();
}

function tweenColor(material, hex) {
  const color = new THREE.Color(hex);
  gsap.to(material.color, {
    r: color.r,
    g: color.g,
    b: color.b,
    duration: 0.45,
    ease: 'power2.out',
    overwrite: 'auto',
  });
}

function makeLabelMaterial(label, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = '600 28px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.SpriteMaterial({ map: texture, transparent: true });
}
