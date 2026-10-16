const MATERIALS = {
  wood:   { density: 0.0015, friction: 0.6, restitution: 0.15 },
  stone:  { density: 0.005, friction: 0.8, restitution: 0.05 },
  metal:  { density: 0.008, friction: 0.4, restitution: 0.1 },
  rubber: { density: 0.0012, friction: 0.9, restitution: 0.85 },
  cloth:  { density: 0.0004, friction: 0.9, restitution: 0 },
  earth:  { density: 0.003, friction: 0.9, restitution: 0 },
};

const round2 = value => Math.round(value * 100) / 100;
const copyScene = scene => JSON.parse(JSON.stringify(scene));
const offset = (point, body) => ({
  x: point.x - body.position.x,
  y: point.y - body.position.y,
});

export function createSim(scene, { gravity = 1, timeScale = 1 } = {}) {
  const Matter = globalThis.Matter;
  if (!Matter) throw new Error('Matter.js must be loaded before createSim');

  const { Engine, Bodies, Body, Composite, Constraint, Events, Mouse,
    MouseConstraint, Vertices, Vector } = Matter;
  const originalScene = copyScene(scene);
  let currentGravity = gravity;
  let currentTimeScale = timeScale;
  let trackedBody = null;
  let startPosition = null;
  let stats = { distance: 0, peak: 0, topSpeed: 0 };
  let motors = [];
  let ropes = [];
  let mouse = null;
  let mouseCanvas = null;
  let resizeMouse = null;

  const sim = {
    engine: null,
    bodies: [],
    bodyById: new Map(),
    joints: [],
    scene: null,
    step() {
      if (!sim.engine) return;
      Engine.update(sim.engine, 1000 / 60);
      if (!trackedBody) return;
      stats.distance = Math.max(stats.distance,
        Math.abs(trackedBody.position.x - startPosition.x) / 100);
      stats.peak = Math.max(stats.peak,
        Math.max(0, startPosition.y - trackedBody.position.y) / 100);
      stats.topSpeed = Math.max(stats.topSpeed, trackedBody.speed * 60 / 100);
    },
    reset() {
      const canvas = mouseCanvas;
      clearWorld();
      build();
      if (canvas) sim.attachMouse(canvas);
    },
    setGravity(value) {
      currentGravity = value;
      if (sim.engine) sim.engine.gravity.y = value;
    },
    setTimeScale(value) {
      currentTimeScale = value;
      if (sim.engine) sim.engine.timing.timeScale = value;
    },
    getStats() {
      return {
        distance: round2(stats.distance),
        peak: round2(stats.peak),
        topSpeed: round2(stats.topSpeed),
      };
    },
    destroy() {
      clearWorld();
    },
    attachMouse(canvas) {
      if (!sim.engine) return;
      removeMouse();
      mouseCanvas = canvas;
      mouse = Mouse.create(canvas);
      resizeMouse = () => {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        // Matter normalizes by canvas.width/clientWidth internally. Cancel that
        // normalization before applying the requested CSS-to-world scale.
        mouse.pixelRatio = canvas.width / rect.width;
        Mouse.setScale(mouse, { x: 1000 / rect.width, y: 625 / rect.height });
      };
      resizeMouse();
      canvas.addEventListener('mousedown', resizeMouse, true);
      window.addEventListener('resize', resizeMouse);
      for (const event of ['mousewheel', 'DOMMouseScroll', 'wheel']) {
        canvas.removeEventListener(event, mouse.mousewheel);
      }
      const drag = MouseConstraint.create(sim.engine, {
        mouse,
        constraint: { stiffness: 0.2, render: { visible: false } },
      });
      Composite.add(sim.engine.world, drag);
    },
  };

  function removeMouse() {
    if (!mouse || !mouseCanvas) return;
    for (const [event, handler] of [
      ['mousemove', mouse.mousemove], ['mousedown', mouse.mousedown],
      ['mouseup', mouse.mouseup], ['touchmove', mouse.mousemove],
      ['touchstart', mouse.mousedown], ['touchend', mouse.mouseup],
    ]) mouseCanvas.removeEventListener(event, handler);
    mouseCanvas.removeEventListener('mousedown', resizeMouse, true);
    window.removeEventListener('resize', resizeMouse);
    mouse = null;
    mouseCanvas = null;
    resizeMouse = null;
  }

  function clearWorld() {
    removeMouse();
    if (sim.engine) {
      Events.off(sim.engine);
      Composite.clear(sim.engine.world, false, true);
      Engine.clear(sim.engine);
    }
    sim.engine = null;
    sim.bodies = [];
    sim.bodyById = new Map();
    sim.joints = [];
    sim.scene = null;
    trackedBody = null;
    startPosition = null;
    stats = { distance: 0, peak: 0, topSpeed: 0 };
    motors = [];
    ropes = [];
  }

  function makeBody(part) {
    const material = MATERIALS[part.material] ? part.material : 'wood';
    const options = { ...MATERIALS[material], frictionAir: 0.002,
      isStatic: !!part.static };
    let body;
    if (part.shape === 'circle') {
      body = Bodies.circle(part.x, part.y, part.radius, options);
    } else if (part.shape === 'rect') {
      body = Bodies.rectangle(part.x, part.y, part.width, part.height, {
        ...options, angle: (part.angle || 0) * Math.PI / 180,
      });
    } else if (part.shape === 'polygon') {
      const points = part.vertices.map(([x, y]) => ({ x, y }));
      try {
        const hull = Vertices.hull(points);
        if (hull.length < 3) throw new Error('Degenerate polygon');
        const centre = Vertices.centre(hull);
        body = Bodies.fromVertices(centre.x, centre.y, [hull], options);
      } catch (_) {
        body = null;
      }
      if (!body) {
        const xs = points.map(point => point.x);
        const ys = points.map(point => point.y);
        const left = Math.min(...xs), right = Math.max(...xs);
        const top = Math.min(...ys), bottom = Math.max(...ys);
        body = Bodies.rectangle((left + right) / 2, (top + bottom) / 2,
          Math.max(1, right - left), Math.max(1, bottom - top), options);
      }
    } else {
      return null;
    }
    if (!body.isStatic && part.mass != null) Body.setMass(body, part.mass);
    body.dv = { id: part.id, label: part.label, material,
      projectile: !!part.projectile, shape: part.shape };
    return body;
  }

  function setCollisionGroups() {
    const parent = new Map(sim.bodies.map(body => [body.dv.id, body.dv.id]));
    const find = id => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root);
      while (parent.get(id) !== root) {
        const next = parent.get(id);
        parent.set(id, root);
        id = next;
      }
      return root;
    };
    for (const joint of sim.scene.joints || []) {
      if ((joint.type === 'hinge' || joint.type === 'weld') &&
          parent.has(joint.a) && parent.has(joint.b)) {
        parent.set(find(joint.a), find(joint.b));
      }
    }
    const groups = new Map();
    for (const body of sim.bodies) {
      const root = find(body.dv.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(body);
    }
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const group = Body.nextGroup(true);
      for (const body of members) body.collisionFilter.group = group;
    }
  }

  function endpoint(constraint, side) {
    const body = constraint[`body${side}`];
    const point = constraint[`point${side}`];
    if (!body) return point;
    // Matter rotates pointA/pointB during constraint solving. Before the next
    // update, include only the rotation since that last solver pass.
    const angle = body.angle - constraint[`angle${side}`];
    const rotated = Vector.rotate(point, angle);
    return { x: body.position.x + rotated.x,
      y: body.position.y + rotated.y };
  }

  function makeJoints() {
    for (const joint of sim.scene.joints || []) {
      const a = sim.bodyById.get(joint.a);
      const b = joint.b == null ? null : sim.bodyById.get(joint.b);
      if (!a || (joint.b != null && !b)) continue;
      let constraints = [];
      let restLength = 0;
      if (joint.type === 'hinge') {
        const point = { x: joint.x ?? a.position.x,
          y: joint.y ?? a.position.y };
        constraints = [Constraint.create({
          bodyA: a, pointA: offset(point, a),
          ...(b ? { bodyB: b, pointB: offset(point, b) } : { pointB: point }),
          length: 0, stiffness: 1, damping: 0,
        })];
      } else if (joint.type === 'rope' || joint.type === 'spring') {
        const pointA = { x: joint.ax ?? a.position.x,
          y: joint.ay ?? a.position.y };
        const pointB = { x: joint.bx ?? (b ? b.position.x : pointA.x),
          y: joint.by ?? (b ? b.position.y : pointA.y - 100) };
        restLength = Vector.magnitude(Vector.sub(pointA, pointB));
        const constraint = Constraint.create({
          bodyA: a, pointA: offset(pointA, a),
          ...(b ? { bodyB: b, pointB: offset(pointB, b) } : { pointB }),
          length: restLength,
          stiffness: joint.type === 'rope' ? 0.9 : 0.02,
          ...(joint.type === 'spring' ? { damping: 0.05 } : {}),
        });
        constraints = [constraint];
        if (joint.type === 'rope') ropes.push({ constraint, restLength });
      } else if (joint.type === 'weld') {
        if (b) {
          for (const point of [a.position, b.position]) {
            constraints.push(Constraint.create({
              bodyA: a, pointA: offset(point, a),
              bodyB: b, pointB: offset(point, b),
              length: 0, stiffness: 1,
            }));
          }
        } else {
          Body.setStatic(a, true);
        }
      } else {
        continue;
      }
      Composite.add(sim.engine.world, constraints);
      sim.joints.push({ type: joint.type, constraints, restLength });
    }
  }

  function build() {
    sim.scene = copyScene(originalScene);
    sim.engine = Engine.create({ positionIterations: 10,
      velocityIterations: 8, constraintIterations: 4, enableSleeping: false });
    sim.engine.gravity.y = currentGravity;
    sim.engine.timing.timeScale = currentTimeScale;

    for (const part of sim.scene.bodies || []) {
      const body = makeBody(part);
      if (!body) continue;
      sim.bodies.push(body);
      sim.bodyById.set(part.id, body);
    }
    Composite.add(sim.engine.world, sim.bodies);
    setCollisionGroups();
    makeJoints();

    motors = (sim.scene.motors || []).flatMap(motor => {
      const body = sim.bodyById.get(motor.body);
      return body ? [{ body, speed: motor.speed }] : [];
    });
    for (const velocity of sim.scene.velocities || []) {
      const body = sim.bodyById.get(velocity.body);
      if (body) Body.setVelocity(body,
        { x: velocity.vx / 60, y: velocity.vy / 60 });
    }

    const boundaries = [
      Bodies.rectangle(500, 725, 5000, 200, { isStatic: true }),
      Bodies.rectangle(-100, 312.5, 200, 5000, { isStatic: true }),
      Bodies.rectangle(1100, 312.5, 200, 5000, { isStatic: true }),
    ];
    for (const body of boundaries) body.dv = { boundary: true };
    Composite.add(sim.engine.world, boundaries);

    const beforeUpdate = () => {
      for (const { body, speed } of motors) {
        Body.setAngularVelocity(body, speed / 60);
      }
      for (const { constraint, restLength } of ropes) {
        const a = endpoint(constraint, 'A');
        const b = endpoint(constraint, 'B');
        constraint.length = Math.min(restLength,
          Vector.magnitude(Vector.sub(a, b)));
      }
    };
    Events.on(sim.engine, 'beforeUpdate', beforeUpdate);

    trackedBody = sim.bodies.find(body => body.dv.projectile) ||
      sim.bodies.filter(body => !body.isStatic && body.dv.shape === 'circle')
        .sort((a, b) => a.circleRadius - b.circleRadius)[0] ||
      sim.bodies.find(body => !body.isStatic) || null;
    startPosition = trackedBody ? { ...trackedBody.position } : null;
  }

  build();
  return sim;
}
