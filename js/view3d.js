const COLORS = {
  wood: '#C49A6C', stone: '#9A8F80', metal: '#7D7A73',
  rubber: '#A0522D', cloth: '#E3D3B0', earth: '#8C6B47',
};

function endpoint(constraint, side) {
  const body = constraint[`body${side}`];
  const point = constraint[`point${side}`];
  if (!body) return point;
  // Matter has already rotated constraint points during its last solver pass.
  const angle = body.angle - (constraint[`angle${side}`] ?? body.angle);
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: body.position.x + point.x * c - point.y * s,
    y: body.position.y + point.x * s + point.y * c };
}

export function createView3D(container, sim) {
  const THREE = globalThis.THREE;
  if (!THREE) throw new Error('Three.js did not load');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2', { antialias: true }) ||
    canvas.getContext('webgl', { antialias: true });
  if (!context) throw new Error('WebGL is unavailable');
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvas.setAttribute('aria-label', '3D simulation. Drag to orbit; scroll to zoom.');
  canvas.tabIndex = 0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#2A1F15');
  const camera = new THREE.PerspectiveCamera(40, 1000 / 625, 1, 10000);
  const target = new THREE.Vector3(500, -312.5, 0);
  let theta = 0.35, phi = 1.15, radius = 1400;
  const parts = new THREE.Group();
  scene.add(parts);
  scene.add(new THREE.AmbientLight('#FFE4BE', 0.65));
  const light = new THREE.DirectionalLight('#FFE0AA', 1.1);
  light.position.set(-300, 800, 900);
  light.target.position.copy(target);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  Object.assign(light.shadow.camera, { left: -1100, right: 1100,
    top: 1100, bottom: -1100, near: 1, far: 4000 });
  light.shadow.normalBias = 1;
  scene.add(light, light.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#4A3826').convertSRGBToLinear(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(500, -625, 0);
  ground.receiveShadow = true;
  scene.add(ground);
  const ink = new THREE.LineBasicMaterial({ color: new THREE.Color('#38271B').convertSRGBToLinear() });
  const cord = new THREE.LineBasicMaterial({ color: new THREE.Color('#D1AE78').convertSRGBToLinear() });
  let currentSim = sim;
  let observedBodies = null;
  let meshes = [];
  let joints = [];
  let frame = 0;
  let running = false;
  let drag = null;
  let width = 0, height = 0, pixelRatio = 0;

  function updateCamera() {
    const horizontal = radius * Math.sin(phi);
    camera.position.set(target.x + horizontal * Math.sin(theta),
      target.y + radius * Math.cos(phi), target.z + horizontal * Math.cos(theta));
    camera.lookAt(target);
  }

  function clearParts() {
    parts.traverse(object => {
      object.geometry?.dispose();
      if (object.isMesh) object.material.dispose();
    });
    parts.clear();
    meshes = [];
    joints = [];
  }

  function rebuild() {
    clearParts();
    observedBodies = currentSim?.bodies || null;
    for (const body of observedBodies || []) {
      if (body.dv?.boundary) continue;
      const c = Math.cos(body.angle), s = Math.sin(body.angle);
      const vertices = body.vertices.map(point => {
        const dx = point.x - body.position.x, dy = point.y - body.position.y;
        return { x: dx * c + dy * s, y: dx * s - dy * c };
      });
      let geometry;
      if (body.circleRadius) {
        geometry = new THREE.CylinderGeometry(body.circleRadius, body.circleRadius, 40, 40);
        geometry.rotateX(Math.PI / 2);
      } else if (body.dv?.shape === 'rect') {
        const xs = vertices.map(point => point.x), ys = vertices.map(point => point.y);
        geometry = new THREE.BoxGeometry(Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys), 60);
      } else {
        const shape = new THREE.Shape();
        vertices.forEach((point, index) => index ? shape.lineTo(point.x, point.y) :
          shape.moveTo(point.x, point.y));
        shape.closePath();
        geometry = new THREE.ExtrudeGeometry(shape, { depth: 60, bevelEnabled: false });
        geometry.translate(0, 0, -30);
      }
      const color = new THREE.Color(COLORS[body.dv?.material] || COLORS.wood).convertSRGBToLinear();
      if (body.isStatic) color.multiplyScalar(0.78);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color,
        roughness: body.dv?.material === 'metal' ? 0.5 : 0.85,
        metalness: body.dv?.material === 'metal' ? 0.35 : 0 }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), ink));
      if (body.circleRadius) {
        mesh.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 20.5),
          new THREE.Vector3(body.circleRadius, 0, 20.5),
        ]), ink));
      }
      parts.add(mesh);
      meshes.push({ body, mesh });
    }
    for (const joint of currentSim?.joints || []) {
      if (joint.type !== 'rope' && joint.type !== 'spring') continue;
      for (const constraint of joint.constraints) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
        const line = new THREE.Line(geometry, cord);
        line.frustumCulled = false;
        parts.add(line);
        joints.push({ joint, constraint, line });
      }
    }
  }

  function draw() {
    if (observedBodies !== (currentSim?.bodies || null)) rebuild();
    const nextWidth = container.clientWidth || 1000;
    const nextHeight = container.clientHeight || nextWidth * 625 / 1000;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (nextWidth !== width || nextHeight !== height || ratio !== pixelRatio) {
      width = nextWidth; height = nextHeight; pixelRatio = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    for (const { body, mesh } of meshes) {
      mesh.position.set(body.position.x, -body.position.y, 0);
      mesh.rotation.z = -body.angle;
    }
    for (const { joint, constraint, line } of joints) {
      const a = endpoint(constraint, 'A'), b = endpoint(constraint, 'B');
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1;
      const slack = Math.max(0, joint.restLength - distance);
      const positions = line.geometry.attributes.position;
      for (let i = 0; i < 18; i++) {
        const t = i / 17;
        const wiggle = joint.type === 'spring' && i > 0 && i < 17 ? (i % 2 ? 7 : -7) : 0;
        const sag = joint.type === 'rope' ? 2 * t * (1 - t) * Math.min(100, slack * 0.7) : 0;
        positions.setXYZ(i, a.x + dx * t - dy / distance * wiggle,
          -(a.y + dy * t + dx / distance * wiggle + sag), 36);
      }
      positions.needsUpdate = true;
    }
    renderer.render(scene, camera);
  }

  function tick() {
    frame = 0;
    if (!running) return;
    draw();
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    theta -= (event.clientX - drag.x) * 0.006;
    phi = Math.max(0.02, Math.min(Math.PI - 0.02, phi - (event.clientY - drag.y) * 0.006));
    drag.x = event.clientX; drag.y = event.clientY;
    updateCamera();
  });
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  canvas.addEventListener('pointerup', event => {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    drag = null;
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    radius = Math.max(500, Math.min(3500, radius * Math.exp(Math.max(-500, Math.min(500, event.deltaY)) * 0.001)));
    updateCamera();
  }, { passive: false });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    stop();
    container.dispatchEvent(new Event('view3d-unavailable'));
  });

  const controls = document.createElement('div');
  controls.className = 'view3d-cameras';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '3D camera views');
  for (const [name, azimuth, polar] of [['Front', 0, Math.PI / 2],
    ['Side', Math.PI / 2, Math.PI / 2], ['Top', 0, 0.02]]) {
    const button = document.createElement('button');
    button.className = 'chip';
    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', () => {
      theta = azimuth; phi = polar; radius = 1400;
      updateCamera();
    });
    controls.append(button);
  }
  const hint = document.createElement('p');
  hint.className = 'view3d-hint';
  hint.textContent = 'Drag to orbit · Scroll to zoom';
  container.append(canvas, controls, hint);
  updateCamera();
  rebuild();
  return {
    start() {
      if (running) return;
      running = true;
      tick();
    },
    stop,
    setSim(nextSim) {
      currentSim = nextSim;
      rebuild();
    },
  };
}
