// Aperçu 3D (three.js) : pièce sur un plateau 220×220 quadrillé, rotation au doigt.
import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

export class Viewer {
  constructor(container, bed = 220) {
    this.el = container;
    this.bed = bed;
    const w = container.clientWidth || 320, h = container.clientHeight || 320;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    // Repère imprimante : Z vers le haut.
    this.camera = new THREE.PerspectiveCamera(40, w / h, 1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(bed * 0.9, -bed * 1.1, bed * 0.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.6);
    d.position.set(150, -200, 300);
    this.scene.add(d);
    this._bed();
    this.mesh = null;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this._loop = () => {
      if (this._dead) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(this._loop);
    };
    this._loop();
  }

  _bed() {
    const b = this.bed;
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(b, b),
      new THREE.MeshBasicMaterial({ color: 0x1b2433, transparent: true, opacity: 0.9 })
    );
    this.scene.add(plate);
    const grid = new THREE.GridHelper(b, b / 10, 0x3b4a63, 0x2a3547);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.05;
    this.scene.add(grid);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(b, b, 250)),
      new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.25 })
    );
    edge.position.z = 125;
    this.scene.add(edge);
  }

  // tris : Float32Array déjà centré/posé (cf. mesh.prepare)
  show(tris, tooBig = false) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      color: tooBig ? 0xef4444 : 0xf59e0b, roughness: 0.55, metalness: 0.05,
    }));
    this.scene.add(this.mesh);
    g.computeBoundingSphere();
    const r = Math.max(30, g.boundingSphere.radius);
    const c = g.boundingSphere.center;
    this.controls.target.set(c.x, c.y, c.z);
    const dist = r * 3.2;
    this.camera.position.set(c.x + dist * 0.6, c.y - dist * 0.75, c.z + dist * 0.55);
    this.controls.update();
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this._dead = true;
    this._ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.el.innerHTML = '';
  }
}
