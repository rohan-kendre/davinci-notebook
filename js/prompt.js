export const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'bodies', 'joints', 'motors', 'velocities', 'note'],
  properties: {
    title: { type: 'string' },
    bodies: { type: 'array', minItems: 1, items: {
      type: 'object',
      properties: {
        id: { type: 'string' }, label: { type: 'string' },
        shape: { type: 'string', enum: ['circle', 'rect', 'polygon'] },
        x: { type: 'number' }, y: { type: 'number' }, radius: { type: 'number' },
        width: { type: 'number' }, height: { type: 'number' }, angle: { type: 'number' },
        vertices: { type: 'array', items: { type: 'array', minItems: 2, maxItems: 2,
          items: { type: 'number' } } },
        material: { type: 'string', enum: ['wood', 'stone', 'metal', 'rubber', 'cloth', 'earth'] },
        static: { type: 'boolean' }, mass: { type: 'number' }, projectile: { type: 'boolean' },
      },
      required: ['id', 'label', 'shape', 'material', 'static'],
    } },
    joints: { type: 'array', items: { type: 'object', properties: {
      type: { type: 'string', enum: ['hinge', 'rope', 'spring', 'weld'] },
      a: { type: 'string' }, b: { type: ['string', 'null'] },
      x: { type: 'number' }, y: { type: 'number' },
      ax: { type: 'number' }, ay: { type: 'number' }, bx: { type: 'number' }, by: { type: 'number' },
    }, required: ['type', 'a', 'b'] } },
    motors: { type: 'array', items: { type: 'object', properties: {
      body: { type: 'string' }, speed: { type: 'number' },
    }, required: ['body', 'speed'] } },
    velocities: { type: 'array', items: { type: 'object', properties: {
      body: { type: 'string' }, vx: { type: 'number' }, vy: { type: 'number' },
    }, required: ['body', 'vx', 'vy'] } },
    note: { type: 'string' },
  },
};

export const SYSTEM_PROMPT = `You are the eyes of Da Vinci's Notebook. The image is exactly 1000 px wide and 625 px tall. Return pixel coordinates in that world, with y increasing downward and the floor at y=625. Output ONLY JSON matching the scene format and supplied schema: {title,bodies,joints,motors,velocities,note}.
Circles, balls and wheels become circle bodies. Beams, planks, boxes and thick lines become rect bodies with angle in degrees. Ramps, wedges and triangles become convex polygons. Ground lines, walls and supports are static true. Pivots, axles and fulcrums become hinge joints, with b set to the support's id or null. Strings and chains are ropes; zigzags are springs; glued parts are welds. Arrows become initial velocities in their direction, about 600 px/s. A text label "5 kg" sets mass; "rubber", "stone", or "metal" sets material. "motor" or a spiral on a wheel sets a motor. Mark the main moving object projectile:true. If the drawing is not a machine, still turn it into shapes that fall and tumble. Add one sentence in Leonardo's voice as note.
Example: {"title":"A Seesaw","bodies":[{"id":"support","label":"Fulcrum","shape":"polygon","vertices":[[470,590],[530,590],[500,530]],"material":"stone","static":true},{"id":"plank","label":"Plank","shape":"rect","x":500,"y":520,"width":360,"height":18,"angle":0,"material":"wood","static":false},{"id":"ball","label":"Ball","shape":"circle","x":360,"y":480,"radius":20,"material":"rubber","static":false,"projectile":true}],"joints":[{"type":"hinge","a":"plank","b":"support","x":500,"y":520}],"motors":[],"velocities":[],"note":"I have balanced a plank that a little ball may command its motion."}`;
