import gsap from 'gsap';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DecorationEditor } from './decorationEditor.js';

const DEFAULT_PRINT_POSITION = { x: 0, y: 0.36, z: 0.5 };
const DECORATION_MESH_NAME_PATTERN = /cloth|fabric|body/i;

export function selectDecorationMeshes(meshes) {
  const clothMeshes = meshes.filter((mesh) => DECORATION_MESH_NAME_PATTERN.test(mesh.name));
  return clothMeshes.length ? clothMeshes : meshes;
}

export class GarmentRenderer {
  constructor(host, options = {}) {
    this.host = host;
    this.onStatePatch = options.onStatePatch;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f3f1ec');
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camera.position.set(0, 1.8, 5.4);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('contextmenu', preventContextMenu);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 9;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.78;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.58;
    this.controls.panSpeed = 0.72;
    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.loader = new GLTFLoader();
    this.root = new THREE.Group();
    this.modelGroup = new THREE.Group();
    this.root.add(this.modelGroup);
    this.scene.add(this.root);
    this.modelMaterials = [];
    this.modelMeshes = [];
    this.decorationMeshes = [];
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.printPlane = null;
    this.printTexture = null;
    this.printMaterial = null;
    this.isDraggingPrint = false;
    this.printColor = '#20242a';
    this.decorationEditor = new DecorationEditor({
      camera: this.camera,
      domElement: this.renderer.domElement,
      scene: this.scene,
      onDecorationsChange: (decorations) => this.onStatePatch?.({ overrides: { decorations } }),
      onSelectionChange: (activeDecorationId) => this.onStatePatch?.({ overrides: { activeDecorationId } }),
    });

    this.addLights();
    this.addFloor();
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    this.animate();
  }

  update(product, state, selected) {
    if (!selected) return;
    this.product = product;
    this.state = state;
    this.selected = selected;

    const modelUrl = product.model?.glbUrl;
    if (modelUrl && modelUrl !== this.currentModelUrl) {
      this.currentModelUrl = modelUrl;
      this.loadModel(modelUrl);
    }

    this.applyColors(selected.colorway.swatches);
    this.applyMaterial(selected.material.material);
    this.updatePrintLayer();
    this.decorationEditor.update(
      state.overrides?.decorations ?? [],
      state.overrides?.activeDecorationId,
      product.decorationPresets ?? [],
    );
    this.controls.enabled = !this.decorationEditor.isEditing() && !this.isDraggingPrint;
  }

  setView(view) {
    const targets = {
      orbit: { position: { x: 0, y: 1.8, z: 5.4 }, target: { x: 0, y: 0.7, z: 0 } },
      top: { position: { x: 0, y: 5.4, z: 0.05 }, target: { x: 0, y: 0.4, z: 0 } },
      detail: { position: { x: 0.85, y: 1.35, z: 2.35 }, target: { x: 0, y: 0.78, z: 0 } },
    };
    const next = targets[view] ?? targets.orbit;
    gsap.to(this.camera.position, {
      ...next.position,
      duration: 0.55,
      ease: 'power2.out',
      onUpdate: () => this.camera.lookAt(this.controls.target),
    });
    gsap.to(this.controls.target, {
      ...next.target,
      duration: 0.55,
      ease: 'power2.out',
    });
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.loadToken = Symbol('disposed');
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.domElement.removeEventListener('contextmenu', preventContextMenu);
    this.renderer?.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer?.domElement.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.disposeGroup(this.root);
    this.disposePrintLayer();
    this.decorationEditor?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }

  async loadModel(modelUrl) {
    const loadToken = Symbol(modelUrl);
    this.loadToken = loadToken;
    try {
      const gltf = await this.loader.loadAsync(modelUrl);
      if (this.loadToken !== loadToken) return;

      this.disposeGroup(this.modelGroup);
      this.modelGroup.clear();
      this.modelMaterials = [];
      this.modelMeshes = [];
      this.decorationMeshes = [];
      const model = gltf.scene;
      model.traverse((item) => {
        if (!item.isMesh) return;
        item.castShadow = true;
        item.receiveShadow = true;
        item.material = cloneMaterials(item.material);
        setGarmentMaterialDefaults(item.material);
        collectMaterials(item.material, this.modelMaterials);
        this.modelMeshes.push(item);
      });

      this.decorationMeshes = selectDecorationMeshes(this.modelMeshes);

      this.modelGroup.add(model);
      this.fitModel(model);
      this.modelGroup.updateMatrixWorld(true);
      this.decorationEditor.setGarmentMeshes(this.decorationMeshes);
      this.decorationEditor.update(
        this.state?.overrides?.decorations ?? [],
        this.state?.overrides?.activeDecorationId,
        this.product?.decorationPresets ?? [],
      );
      this.applyColors(this.selected?.colorway?.swatches);
      this.applyMaterial(this.selected?.material?.material);
      this.updatePrintLayer();
      gsap.fromTo(model.scale, { x: model.scale.x * 0.94, y: model.scale.y * 0.94, z: model.scale.z * 0.94 }, {
        x: model.scale.x,
        y: model.scale.y,
        z: model.scale.z,
        duration: 0.55,
        ease: 'power2.out',
      });
    } catch (error) {
      console.error(`Unable to load garment model: ${modelUrl}`, error);
    }
  }

  fitModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDimension = Math.max(size.x, size.y, size.z) || 1;
    const scale = 2.35 / maxDimension;
    model.scale.setScalar(scale);
    model.position.set(
      -center.x * scale,
      -center.y * scale,
      -center.z * scale,
    );

    const fittedBox = new THREE.Box3().setFromObject(model);
    const fittedSize = new THREE.Vector3();
    fittedBox.getSize(fittedSize);
    this.controls.target.set(0, 0.06, 0);
    this.camera.position.set(0, fittedSize.y * 0.12 + 0.72, Math.max(5.2, fittedSize.z + 4.8));
    this.camera.lookAt(this.controls.target);
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#7f766c', 2.4));

    const key = new THREE.DirectionalLight('#fff4e8', 3.4);
    key.position.set(3.5, 5.8, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight('#b9d7ff', 1.7);
    rim.position.set(-4.5, 2.8, -3.2);
    this.scene.add(rim);
  }

  addFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.3, 72),
      new THREE.MeshStandardMaterial({ color: '#dedbd4', roughness: 0.76, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.58;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  applyColors(swatches) {
    if (!swatches) return;
    const fabric = new THREE.Color(swatches.fabric ?? swatches.case ?? '#f8f5ed');
    const trim = new THREE.Color(swatches.trim ?? swatches.accent ?? '#20242a');
    this.printColor = swatches.number ?? swatches.trim ?? swatches.accent ?? '#20242a';
    this.modelMaterials.forEach((material, index) => {
      if (!material.color) return;
      const target = index % 3 === 0 ? trim : fabric;
      gsap.to(material.color, {
        r: target.r,
        g: target.g,
        b: target.b,
        duration: 0.45,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    });
    this.scene.background.set(fabric).lerp(new THREE.Color('#f7f5ef'), 0.84);
    this.redrawPrintTexture();
  }

  applyMaterial(materialOptions) {
    if (!materialOptions) return;
    this.modelMaterials.forEach((material) => {
      if ('roughness' in material) {
        gsap.to(material, {
          roughness: materialOptions.roughness,
          metalness: materialOptions.metalness,
          duration: 0.45,
          ease: 'power2.out',
          overwrite: 'auto',
        });
      }
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
      if (item.material) disposeMaterials(item.material);
    });
  }

  updatePrintLayer() {
    const printEnabled = this.state?.lighting && this.state.lighting !== 'none';
    if (!printEnabled) {
      this.disposePrintLayer();
      return;
    }

    if (!this.printPlane) {
      this.printTexture = new THREE.CanvasTexture(makePrintCanvas(this.getPrintOptions()));
      this.printTexture.colorSpace = THREE.SRGBColorSpace;
      this.printMaterial = new THREE.MeshBasicMaterial({
        map: this.printTexture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.printPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.42), this.printMaterial);
      this.printPlane.renderOrder = 4;
      this.scene.add(this.printPlane);
    }

    this.redrawPrintTexture();
    this.applyStoredPrintPlacement();
  }

  redrawPrintTexture() {
    if (!this.printTexture) return;
    const nextCanvas = makePrintCanvas(this.getPrintOptions());
    this.printTexture.image = nextCanvas;
    this.printTexture.needsUpdate = true;
  }

  getPrintOptions() {
    const overrides = this.state?.overrides ?? {};
    return {
      name: sanitizePrintText(overrides.printName ?? 'PLAYER'),
      number: sanitizePrintText(overrides.printNumber ?? '16'),
      color: this.printColor,
      raised: this.state?.lighting === 'raised-print',
    };
  }

  applyStoredPrintPlacement() {
    if (!this.printPlane) return;
    const stored = this.state?.overrides?.printPlacement ?? DEFAULT_PRINT_POSITION;
    this.printPlane.position.set(stored.x, stored.y, stored.z);
    if (stored.normal) {
      this.printPlane.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(stored.normal.x, stored.normal.y, stored.normal.z).normalize(),
      );
    } else {
      this.printPlane.quaternion.identity();
    }
  }

  disposePrintLayer() {
    if (this.printPlane) {
      this.scene.remove(this.printPlane);
      this.printPlane.geometry.dispose();
      this.printPlane = null;
    }
    this.printMaterial?.dispose();
    this.printMaterial = null;
    this.printTexture?.dispose();
    this.printTexture = null;
    this.isDraggingPrint = false;
  }

  handlePointerDown = (event) => {
    if (this.decorationEditor?.handlePointerDown(event)) {
      this.controls.enabled = !this.decorationEditor.isEditing();
      event.preventDefault();
      return;
    }
    if (!this.printPlane || !this.isPrintEditable()) return;
    const hit = this.pickJersey(event);
    if (!hit) return;
    event.preventDefault();
    this.isDraggingPrint = true;
    this.controls.enabled = false;
    this.placePrintAtIntersection(hit, true);
  };

  handlePointerMove = (event) => {
    if (this.decorationEditor?.handlePointerMove(event)) {
      event.preventDefault();
      return;
    }
    if (!this.isDraggingPrint || !this.printPlane) return;
    const hit = this.pickJersey(event);
    if (!hit) return;
    event.preventDefault();
    this.placePrintAtIntersection(hit, false);
  };

  handlePointerUp = () => {
    if (this.decorationEditor?.handlePointerUp()) {
      this.controls.enabled = !this.decorationEditor.isEditing();
      return;
    }
    if (!this.isDraggingPrint) return;
    this.isDraggingPrint = false;
    this.controls.enabled = true;
    this.emitPrintPlacement();
  };

  isPrintEditable() {
    return this.state?.lighting && this.state.lighting !== 'none' && this.decorationMeshes.length > 0;
  }

  pickJersey(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.decorationMeshes, false)[0] ?? null;
  }

  placePrintAtIntersection(hit, animate = false) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const normal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    const position = hit.point.clone().addScaledVector(normal, 0.018);
    const nextQuaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    if (animate) {
      gsap.to(this.printPlane.position, {
        x: position.x,
        y: position.y,
        z: position.z,
        duration: 0.16,
        ease: 'power2.out',
      });
    } else {
      this.printPlane.position.copy(position);
    }
    this.printPlane.quaternion.copy(nextQuaternion);
  }

  emitPrintPlacement() {
    if (!this.printPlane || !this.onStatePatch) return;
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.printPlane.quaternion).normalize();
    this.onStatePatch({
      overrides: {
        printPlacement: {
          x: roundPlacement(this.printPlane.position.x),
          y: roundPlacement(this.printPlane.position.y),
          z: roundPlacement(this.printPlane.position.z),
          normal: {
            x: roundPlacement(normal.x),
            y: roundPlacement(normal.y),
            z: roundPlacement(normal.z),
          },
        },
      },
    });
  }

  patchSelectedDecoration(patch) {
    const changed = this.decorationEditor?.patchSelected(patch);
    if (changed) this.controls.enabled = false;
    return changed;
  }
}

function preventContextMenu(event) {
  event.preventDefault();
}

function cloneMaterials(material) {
  if (Array.isArray(material)) {
    return material.map((item) => item.clone());
  }
  return material?.clone();
}

function setGarmentMaterialDefaults(material) {
  if (Array.isArray(material)) {
    material.forEach(setGarmentMaterialDefaults);
    return;
  }
  if (!material) return;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.opacity = 1;
  material.needsUpdate = true;
}

function collectMaterials(material, materials) {
  if (Array.isArray(material)) {
    material.forEach((item) => collectMaterials(item, materials));
    return;
  }
  if (material) materials.push(material);
}

function disposeMaterials(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterials);
    return;
  }
  material.map?.dispose();
  material.normalMap?.dispose();
  material.roughnessMap?.dispose();
  material.metalnessMap?.dispose();
  material.dispose();
}

function makePrintCanvas({ color, name, number, raised }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 420;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  if (raised) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 5;
  }
  ctx.font = '900 96px Arial, sans-serif';
  ctx.fillText(name || 'PLAYER', canvas.width / 2, 95);
  ctx.font = '900 210px Arial, sans-serif';
  ctx.fillText(number || '16', canvas.width / 2, 260);
  return canvas;
}

function sanitizePrintText(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9 .-]/g, '').slice(0, 14);
}

function roundPlacement(value) {
  return Math.round(value * 10000) / 10000;
}
