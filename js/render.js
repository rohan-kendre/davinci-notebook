const WIDTH = 1000;
const HEIGHT = 625;
const INK = '#2E2116';
const MATERIAL_COLORS = {
  wood: '#C49A6C',
  stone: '#9A8F80',
  metal: '#7D7A73',
  rubber: '#A0522D',
  cloth: '#E3D3B0',
  earth: '#8C6B47',
};

function drawPath(ctx, vertices, dx = 0, dy = 0) {
  if (!vertices.length) return;
  ctx.beginPath();
  ctx.moveTo(vertices[0].x + dx, vertices[0].y + dy);
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(vertices[i].x + dx, vertices[i].y + dy);
  }
  ctx.closePath();
}

function idOffset(id) {
  let hash = 0;
  for (const char of String(id ?? '')) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return { x: ((hash & 7) - 3.5) * 0.3,
    y: (((hash >>> 3) & 7) - 3.5) * 0.3 };
}

function worldPoint(constraint, side) {
  const body = constraint[`body${side}`];
  const point = constraint[`point${side}`];
  if (!body) return point;
  const angle = body.angle - (constraint[`angle${side}`] ?? body.angle);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: body.position.x + point.x * cosine - point.y * sine,
    y: body.position.y + point.x * sine + point.y * cosine };
}

export function createRenderer(canvas, sim,
  { sketchImage = null, showLabels = false, showSketch = true } = {}) {
  const ctx = canvas.getContext('2d');
  let currentSim = sim;
  let currentSketch = sketchImage;
  let labelsVisible = showLabels;
  let sketchVisible = showSketch;
  let fontRequested = false;
  let observedBodies = null;
  let frame = 0;
  let trail = [];

  function prepareCanvas() {
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.round(WIDTH * ratio);
    const height = Math.round(HEIGHT * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
  }

  function drawPaper() {
    ctx.fillStyle = '#FBF5E6';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.beginPath();
    for (let x = 125; x < WIDTH; x += 125) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HEIGHT);
    }
    for (let y = 125; y < HEIGHT; y += 125) {
      ctx.moveTo(0, y);
      ctx.lineTo(WIDTH, y);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#E2D3B0';
    ctx.stroke();

    const shade = ctx.createRadialGradient(500, 312.5, 180, 500, 312.5, 650);
    shade.addColorStop(0, 'rgba(185,142,85,0)');
    shade.addColorStop(0.65, 'rgba(185,142,85,0)');
    shade.addColorStop(1, 'rgba(185,142,85,0.10)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function drawSketch() {
    if (!sketchVisible || !currentSketch) return;
    if ('complete' in currentSketch &&
        (!currentSketch.complete || !currentSketch.naturalWidth)) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(currentSketch, 0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  function drawGround() {
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT);
    ctx.lineTo(WIDTH, HEIGHT);
    ctx.strokeStyle = '#3B2A1A';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  function trackProjectile(bodies) {
    if (bodies !== observedBodies) {
      observedBodies = bodies;
      trail = [];
      frame = 0;
    }
    const projectile = bodies.find(body => body.dv?.projectile) ||
      bodies.filter(body => !body.isStatic && body.dv?.shape === 'circle')
        .sort((a, b) => a.circleRadius - b.circleRadius)[0];
    if (!projectile) return;
    if (frame++ % 3 === 0) {
      const last = trail[trail.length - 1];
      const { x, y } = projectile.position;
      if (!last || Math.hypot(x - last.x, y - last.y) >= 2) {
        trail.push({ x, y });
        if (trail.length > 90) trail.shift();
      }
    }
    ctx.save();
    ctx.fillStyle = '#8B3E1C';
    for (let i = 0; i < trail.length; i++) {
      const point = trail[i];
      ctx.globalAlpha = 0.12 + 0.68 * (i + 1) / trail.length;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBody(body) {
    if (body.dv?.boundary) return;
    const parts = body.parts?.length > 1 ? body.parts.slice(1) : [body];
    const offset = idOffset(body.dv?.id);
    ctx.lineJoin = 'round';
    for (const part of parts) {
      const vertices = part.vertices || [];
      if (!vertices.length) continue;
      drawPath(ctx, vertices);
      ctx.fillStyle = MATERIAL_COLORS[body.dv?.material] || MATERIAL_COLORS.wood;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      if (body.isStatic) {
        const xs = vertices.map(vertex => vertex.x);
        const ys = vertices.map(vertex => vertex.y);
        const left = Math.min(...xs), right = Math.max(...xs);
        const top = Math.min(...ys), bottom = Math.max(...ys);
        const height = bottom - top;
        ctx.save();
        drawPath(ctx, vertices);
        ctx.clip();
        ctx.beginPath();
        for (let x = left - height; x <= right; x += 8) {
          ctx.moveTo(x, top);
          ctx.lineTo(x + height, bottom);
        }
        ctx.strokeStyle = 'rgba(46,33,22,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      drawPath(ctx, vertices, offset.x, offset.y);
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    if (body.dv?.shape === 'circle' && body.circleRadius) {
      ctx.beginPath();
      ctx.moveTo(body.position.x, body.position.y);
      ctx.lineTo(body.position.x + Math.cos(body.angle) * body.circleRadius,
        body.position.y + Math.sin(body.angle) * body.circleRadius);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.7;
      ctx.stroke();
    }
  }

  function drawJoints(joints) {
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    for (const joint of joints) {
      if (joint.type === 'weld') continue;
      for (const constraint of joint.constraints) {
        const a = worldPoint(constraint, 'A');
        const b = worldPoint(constraint, 'B');
        if (joint.type === 'hinge') {
          ctx.beginPath();
          ctx.arc(a.x, a.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#FBF5E6';
          ctx.fill();
          ctx.lineWidth = 1.8;
          ctx.stroke();
        } else if (joint.type === 'rope') {
          const distance = Math.hypot(b.x - a.x, b.y - a.y);
          const slack = Math.max(0, joint.restLength - distance);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          if (slack > 2) {
            ctx.quadraticCurveTo((a.x + b.x) / 2,
              (a.y + b.y) / 2 + Math.min(100, slack * 0.7), b.x, b.y);
          } else {
            ctx.lineTo(b.x, b.y);
          }
          ctx.lineWidth = 1.6;
          ctx.stroke();
        } else if (joint.type === 'spring') {
          const dx = b.x - a.x, dy = b.y - a.y;
          const length = Math.hypot(dx, dy) || 1;
          const nx = -dy / length, ny = dx / length;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          for (let i = 1; i <= 16; i++) {
            const t = i / 17;
            const side = i % 2 ? 7 : -7;
            ctx.lineTo(a.x + dx * t + nx * side,
              a.y + dy * t + ny * side);
          }
          ctx.lineTo(b.x, b.y);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
    }
  }

  function drawLabels(bodies) {
    if (!labelsVisible) return;
    if (!fontRequested && document.fonts?.load) {
      fontRequested = true;
      document.fonts.load('20px Caveat').catch(() => {});
    }
    ctx.font = '20px Caveat, cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#6B4626';
    for (const body of bodies) {
      if (body.dv?.boundary || !body.dv?.label) continue;
      ctx.fillText(body.dv.label,
        (body.bounds.min.x + body.bounds.max.x) / 2, body.bounds.min.y - 8);
    }
  }

  function drawDragging(engine) {
    if (!engine?.world || !globalThis.Matter) return;
    const drag = globalThis.Matter.Composite.allConstraints(engine.world)
      .find(constraint => constraint.label === 'Mouse Constraint' && constraint.bodyB);
    if (!drag?.pointA || !drag.pointB) return;
    const point = worldPoint(drag, 'B');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(drag.pointA.x, drag.pointA.y);
    ctx.lineTo(point.x, point.y);
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#8B3E1C';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  return {
    draw() {
      prepareCanvas();
      drawPaper();
      drawSketch();
      drawGround();
      const bodies = currentSim?.bodies || [];
      trackProjectile(bodies);
      for (const body of bodies) drawBody(body);
      drawJoints(currentSim?.joints || []);
      drawLabels(bodies);
      drawDragging(currentSim?.engine);
    },
    set(option, value) {
      if (option === 'showLabels') labelsVisible = value;
      else if (option === 'showSketch') sketchVisible = value;
      else if (option === 'sketchImage') currentSketch = value;
      else if (option === 'sim') currentSim = value;
    },
  };
}
