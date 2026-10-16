const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const x = value => clamp(number(value, 500), -100, 1100);
const y = value => clamp(number(value, 312), -300, 700);
const size = value => Math.max(6, number(value, 6));
const materials = { steel: 'metal', iron: 'metal', rock: 'stone', brick: 'stone', ball: 'rubber', tyre: 'rubber' };
const validMaterials = new Set(['wood', 'stone', 'metal', 'rubber', 'cloth', 'earth']);

export function normalizeScene(raw) {
  let source;
  try { source = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { source = null; }
  const input = Array.isArray(source?.bodies) ? source.bodies : [];
  if (!input.length) throw new Error('No parts found');

  const ids = new Set();
  const aliases = new Map();
  const bodies = input.map((part, index) => {
    const item = part && typeof part === 'object' ? part : {};
    const originalId = typeof item.id === 'string' ? item.id.trim() : '';
    const root = originalId || `part-${index + 1}`;
    let id = root;
    for (let suffix = 2; ids.has(id); suffix++) id = `${root}-${suffix}`;
    ids.add(id);
    if (originalId && !aliases.has(originalId)) aliases.set(originalId, id);
    const shape = ['circle', 'rect', 'polygon'].includes(item.shape) ? item.shape :
      item.radius != null ? 'circle' : Array.isArray(item.vertices) ? 'polygon' : 'rect';
    const rawMaterial = String(item.material || 'wood').toLowerCase().trim();
    const material = materials[rawMaterial] || (validMaterials.has(rawMaterial) ? rawMaterial : 'wood');
    const body = { id, label: String(item.label || shape).trim() || shape,
      shape, material, static: item.static === true, projectile: item.projectile === true };
    if (Number.isFinite(Number(item.mass)) && number(item.mass) > 0) {
      body.mass = clamp(number(item.mass), 0.05, 1000);
    }
    if (shape === 'circle') {
      Object.assign(body, { x: x(item.x), y: y(item.y), radius: size(item.radius) });
    } else if (shape === 'rect') {
      Object.assign(body, { x: x(item.x), y: y(item.y), width: size(item.width),
        height: size(item.height), angle: number(item.angle) });
    } else {
      const points = (Array.isArray(item.vertices) ? item.vertices : [])
        .filter(point => Array.isArray(point) && point.length >= 2)
        .map(point => [x(point[0]), y(point[1])]);
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
          height: size(bottom - top), angle: number(item.angle) });
      }
    }
    return body;
  });

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
    for (const body of bodies) body.static = body === floor;
  }
  if (!bodies.some(body => body.projectile)) {
    const smallest = bodies.filter(body => !body.static && body.shape === 'circle')
      .sort((a, b) => a.radius - b.radius)[0];
    if (smallest) smallest.projectile = true;
  }

  const byId = new Map(bodies.map(body => [body.id, body]));
  const resolve = value => byId.has(value) ? value : aliases.get(value);
  const joints = (Array.isArray(source?.joints) ? source.joints : []).flatMap(item => {
    const a = resolve(item?.a);
    const b = item?.b == null ? null : resolve(item.b);
    if (!a || (item?.b != null && !b)) return [];
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
  });
  const motors = (Array.isArray(source?.motors) ? source.motors : []).flatMap(item => {
    const body = resolve(item?.body);
    return body ? [{ body, speed: clamp(number(item.speed), -10, 10) }] : [];
  });
  const velocities = (Array.isArray(source?.velocities) ? source.velocities : []).flatMap(item => {
    const body = resolve(item?.body);
    return body ? [{ body, vx: clamp(number(item.vx), -2000, 2000),
      vy: clamp(number(item.vy), -2000, 2000) }] : [];
  });
  return { title: String(source?.title || 'Your Invention').trim() || 'Your Invention',
    bodies, joints, motors, velocities, note: String(source?.note || '').trim().slice(0, 200) };
}
