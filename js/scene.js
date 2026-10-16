const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback = 0) => {
  if (value == null || typeof value === 'boolean' ||
      (typeof value !== 'number' && typeof value !== 'string') || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const x = value => clamp(number(value, 500), -100, 1100);
const y = value => clamp(number(value, 312), -300, 700);
const size = (value, maximum = 1200) => clamp(number(value, 6), 6, maximum);
const truth = value => value === true || value === 'true';
const materials = { steel: 'metal', iron: 'metal', rock: 'stone', brick: 'stone', ball: 'rubber', tyre: 'rubber' };
const validMaterials = new Set(['wood', 'stone', 'metal', 'rubber', 'cloth', 'earth']);

// Some vision models wrap geometry under a shape key even when asked for flat
// fields. Bring that known format into the scene contract before validation.
function flattenBody(part) {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return part;
  const shape = ['circle', 'rect', 'polygon'].includes(part.shape) ? part.shape :
    ['circle', 'rect', 'polygon'].find(name => part[name] != null);
  if (!shape || part[shape] == null) return part;
  const nested = part[shape];
  if (shape === 'polygon') {
    return { ...part, shape,
      vertices: part.vertices ?? (Array.isArray(nested) ? nested : nested?.vertices) };
  }
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return part;
  return { ...nested, ...part, shape,
    height: part.height ?? nested.height ?? nested.thickness };
}

// A convex hull removes duplicate/collinear points and self-crossing order,
// keeping malformed vision polygons safe for the physics engine.
function convexHull(points) {
  const sorted = [...new Map(points.map(p => [p.join(','), p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = sequence => {
    const hull = [];
    for (const p of sequence) {
      while (hull.length >= 2 && cross(hull.at(-2), hull.at(-1), p) <= 0) hull.pop();
      hull.push(p);
    }
    return hull.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function normalizeScene(raw) {
  let source;
  try { source = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { source = null; }
  const input = Array.isArray(source?.bodies) ? source.bodies.map(flattenBody)
    .filter(part => part && typeof part === 'object' && !Array.isArray(part) &&
      (['circle', 'rect', 'polygon'].includes(part.shape) || part.radius != null ||
       part.width != null || part.height != null || Array.isArray(part.vertices)))
    .slice(0, 64) : [];
  if (!input.length) throw new Error('No parts found');

  const ids = new Set();
  const aliases = new Map();
  const parsedBodies = input.map((part, index) => {
    const item = part && typeof part === 'object' ? part : {};
    const originalId = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id).trim() : '';
    const root = originalId || `part-${index + 1}`;
    let id = root;
    for (let suffix = 2; ids.has(id); suffix++) id = `${root}-${suffix}`;
    ids.add(id);
    if (originalId && !aliases.has(originalId)) aliases.set(originalId, id);
    const shape = ['circle', 'rect', 'polygon'].includes(item.shape) ? item.shape :
      item.radius != null ? 'circle' : Array.isArray(item.vertices) ? 'polygon' : 'rect';
    const rawMaterial = String(item.material || 'wood').toLowerCase().trim();
    const material = materials[rawMaterial] || (validMaterials.has(rawMaterial) ? rawMaterial : 'wood');
    const body = { id, label: String(item.label || shape).trim().slice(0, 80) || shape,
      shape, material, static: truth(item.static), projectile: truth(item.projectile) };
    if (Number.isFinite(Number(item.mass)) && number(item.mass) > 0) {
      body.mass = clamp(number(item.mass), 0.05, 1000);
    }
    if (shape === 'circle') {
      Object.assign(body, { x: x(item.x), y: y(item.y), radius: size(item.radius, 500) });
    } else if (shape === 'rect') {
      Object.assign(body, { x: x(item.x), y: y(item.y), width: size(item.width),
        height: size(item.height, 900), angle: number(item.angle) % 360 });
    } else {
      const points = convexHull((Array.isArray(item.vertices) ? item.vertices : []).slice(0, 64)
        .filter(point => Array.isArray(point) && point.length >= 2)
        .filter(point => Number.isFinite(number(point[0], NaN)) && Number.isFinite(number(point[1], NaN)))
        .map(point => [x(point[0]), y(point[1])]));
      if (points.length >= 3) body.vertices = points;
      else {
        const xs = points.map(point => point[0]);
        const ys = points.map(point => point[1]);
        const left = xs.length ? Math.min(...xs) : x(item.x) - size(item.width) / 2;
        const right = xs.length ? Math.max(...xs) : x(item.x) + size(item.width) / 2;
        const top = ys.length ? Math.min(...ys) : y(item.y) - size(item.height) / 2;
        const bottom = ys.length ? Math.max(...ys) : y(item.y) + size(item.height) / 2;
        Object.assign(body, { shape: 'rect', x: x((left + right) / 2),
          y: y((top + bottom) / 2), width: size(right - left),
          height: size(bottom - top, 900), angle: number(item.angle) % 360 });
      }
    }
    return body;
  });

  const bodies = [];
  const overlaps = new Map();
  for (const body of parsedBodies) {
    const geometry = body.shape === 'polygon' ? body.vertices :
      body.shape === 'circle' ? [body.x, body.y, body.radius] :
        [body.x, body.y, body.width, body.height, body.angle];
    const key = JSON.stringify([body.shape, geometry]);
    const duplicate = overlaps.get(key);
    if (duplicate) {
      // Exact overlapping copies are a common model failure. Keep all names
      // resolvable so references to a removed duplicate still find the body.
      aliases.set(body.id, duplicate.id);
      duplicate.projectile ||= body.projectile;
      if (duplicate.mass == null && body.mass != null) duplicate.mass = body.mass;
    } else {
      overlaps.set(key, body);
      bodies.push(body);
    }
  }

  const centre = body => body.shape === 'polygon' ? {
    x: body.vertices.reduce((total, point) => total + point[0], 0) / body.vertices.length,
    y: body.vertices.reduce((total, point) => total + point[1], 0) / body.vertices.length,
  } : { x: body.x, y: body.y };
  if (!bodies.some(body => !body.static)) {
    const grounded = bodies.filter(body => {
      const bottom = body.shape === 'circle' ? body.y + body.radius :
        body.shape === 'polygon' ? Math.max(...body.vertices.map(point => point[1])) : body.y + body.height / 2;
      return bottom >= 625 * 0.85;
    });
    const width = body => body.shape === 'circle' ? body.radius * 2 :
      body.shape === 'polygon' ? Math.max(...body.vertices.map(point => point[0])) -
        Math.min(...body.vertices.map(point => point[0])) : body.width;
    const floor = grounded.sort((a, b) => width(b) - width(a))[0];
    const support = /\b(ground|floor|wall|support|fulcrum|anchor|base|ramp)\b/i;
    for (const body of bodies) {
      body.static = body === floor || support.test(`${body.id} ${body.label}`) || body.material === 'earth';
    }
  }
  // Track a moving part only; model mistakes must not pin statistics to ground.
  for (const body of bodies) if (body.static) body.projectile = false;
  if (!bodies.some(body => body.projectile)) {
    const smallest = bodies.filter(body => !body.static && body.shape === 'circle')
      .sort((a, b) => a.radius - b.radius)[0];
    if (smallest) smallest.projectile = true;
  }

  const byId = new Map(bodies.map(body => [body.id, body]));
  const resolve = value => {
    const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    return byId.has(id) ? id : aliases.get(id);
  };
  let joints = (Array.isArray(source?.joints) ? source.joints : []).flatMap(item => {
    const a = resolve(item?.a);
    const b = item?.b == null ? null : resolve(item.b);
    if (!a || a === b || (item?.b != null && !b)) return [];
    if (item.type === 'hinge') {
      const point = centre(byId.get(a));
      return [{ type: 'hinge', a, b, x: x(item.x ?? point.x), y: y(item.y ?? point.y) }];
    }
    if (item.type === 'rope' || item.type === 'spring') {
      const pointA = centre(byId.get(a));
      const pointB = b ? centre(byId.get(b)) : { x: pointA.x, y: pointA.y - 100 };
      return [{ type: item.type, a, b, ax: x(item.ax ?? pointA.x), ay: y(item.ay ?? pointA.y),
        bx: x(item.bx ?? pointB.x), by: y(item.by ?? pointB.y) }];
    }
    return item.type === 'weld' && b ? [{ type: 'weld', a, b }] : [];
  }).slice(0, 128);

  // Small dots labelled as pivots often appear as invented free bodies. If a
  // hinge already connects that dot to a fixed support, attach the nearby
  // beam directly to that support at the same world-space point.
  for (const pivot of [...bodies]) {
    if (pivot.shape !== 'circle' || pivot.radius > 16 ||
        !/\b(pivot|axle|hinge|pin)\b/i.test(`${pivot.id} ${pivot.label}`)) continue;
    const anchored = joints.find(joint => joint.type === 'hinge' &&
      (joint.a === pivot.id || joint.b === pivot.id) &&
      (joint.a === pivot.id ? joint.b === null || byId.get(joint.b)?.static
        : byId.get(joint.a)?.static));
    if (!anchored) continue;
    const moving = bodies.filter(body => !body.static && body.id !== pivot.id &&
      (body.shape === 'rect' || body.shape === 'polygon') &&
      /\b(beam|lever|plank|arm)\b/i.test(`${body.id} ${body.label}`))
      .map(body => ({ body, point: centre(body) }))
      .filter(({ body, point }) => Math.hypot(point.x - pivot.x, point.y - pivot.y) <=
        (body.shape === 'rect' ? body.width :
          Math.max(...body.vertices.map(p => p[0])) - Math.min(...body.vertices.map(p => p[0]))) / 2 + 30)
      .sort((a, b) => Math.hypot(a.point.x - pivot.x, a.point.y - pivot.y) -
        Math.hypot(b.point.x - pivot.x, b.point.y - pivot.y))[0]?.body;
    if (!moving) continue;
    const supportId = anchored.a === pivot.id ? anchored.b : anchored.a;
    joints = joints.filter(joint => joint.a !== pivot.id && joint.b !== pivot.id);
    if (!joints.some(joint => joint.type === 'hinge' && joint.a === moving.id && joint.b === supportId)) {
      joints.push({ type: 'hinge', a: moving.id, b: supportId, x: pivot.x, y: pivot.y });
    }
    bodies.splice(bodies.indexOf(pivot), 1);
    byId.delete(pivot.id);
    aliases.set(pivot.id, moving.id);
  }
  const motors = (Array.isArray(source?.motors) ? source.motors : []).flatMap(item => {
    const body = resolve(item?.body);
    const part = byId.get(body);
    if (!part || part.static || /\b(ball|stone|projectile|weight)\b/i.test(part.label)) return [];
    const speed = clamp(number(item.speed), -10, 10);
    return Math.abs(speed) > 0.01 ? [{ body, speed }] : [];
  });
  const velocities = (Array.isArray(source?.velocities) ? source.velocities : []).flatMap(item => {
    const body = resolve(item?.body);
    if (!body || byId.get(body).static) return [];
    const vx = clamp(number(item.vx), -2000, 2000);
    const vy = clamp(number(item.vy), -2000, 2000);
    return Math.abs(vx) + Math.abs(vy) > 0.01 ? [{ body, vx, vy }] : [];
  });
  return { title: String(source?.title || 'Your Invention').trim().slice(0, 100) || 'Your Invention',
    bodies, joints, motors, velocities, note: String(source?.note || '').trim().slice(0, 200) };
}
