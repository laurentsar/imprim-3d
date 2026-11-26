// Vignette d'un fichier 3D sans image : rendu three.js hors écran → JPEG (data URL).
import * as THREE from 'three';
import { loadModel, prepare, bestFlatRotation, concat } from './mesh.js';

let renderer = null;

export async function renderThumb(name, data, size = 640) {
  const { objects } = await loadModel(name, data);
  const raw = objects.length > 1 ? concat(objects.map(o => o.tris)) : objects[0].tris;
  const tris = prepare(raw, { rot: bestFlatRotation(raw) });

  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
  }
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x18243a, 1);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.5));
  const d = new THREE.DirectionalLight(0xffffff, 1.8);
  d.position.set(1, -1.4, 2);
  scene.add(d);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.55, metalness: 0.05 }));
  scene.add(mesh);
  g.computeBoundingSphere();
  const { center: c, radius: r } = g.boundingSphere;

  const cam = new THREE.PerspectiveCamera(30, 1, r / 50, r * 20);
  cam.up.set(0, 0, 1);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05;
  const dir = new THREE.Vector3(0.62, -0.78, 0.55).normalize();
  cam.position.copy(c).addScaledVector(dir, dist);
  cam.lookAt(c);
  d.position.copy(cam.position).add(new THREE.Vector3(0, 0, r * 2));

  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.82);
  g.dispose();
  mesh.material.dispose();
  return url;
}
