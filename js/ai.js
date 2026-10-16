import { SCENE_SCHEMA, SYSTEM_PROMPT } from './prompt.js';

const MOCK_SCENE = {
  title: 'Your Tipping Catapult',
  bodies: [
    { id: 'ground', label: 'Ground', shape: 'rect', x: 500, y: 610,
      width: 1000, height: 25, material: 'earth', static: true },
    { id: 'fulcrum', label: 'Fulcrum', shape: 'polygon',
      vertices: [[455, 565], [545, 565], [500, 480]], material: 'stone', static: true },
    { id: 'plank', label: 'Throwing plank', shape: 'rect', x: 500, y: 468,
      width: 500, height: 18, angle: 0, material: 'wood', static: false },
    { id: 'ball', label: 'Ball', shape: 'circle', x: 310, y: 438,
      radius: 20, material: 'rubber', static: false, projectile: true },
    { id: 'weight', label: 'Heavy box', shape: 'rect', x: 690, y: 270,
      width: 60, height: 60, material: 'stone', static: false, mass: 20 },
  ],
  joints: [{ type: 'hinge', a: 'plank', b: 'fulcrum', x: 500, y: 468 }],
  motors: [], velocities: [],
  note: 'A falling weight upon one end shall send the little ball dancing from the other.',
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const provider = settings => settings?.provider === 'ollama' ? 'ollama' : 'mock';
const endpoint = settings => `${String(settings?.ollamaUrl || 'http://localhost:11434').replace(/\/+$/, '')}/api/chat`;
const model = settings => settings?.model || settings?.ollamaModel || 'qwen3-vl:8b';

async function chat(settings, payload) {
  let body = { model: model(settings), stream: false, think: false, ...payload };
  for (let retry = 0; retry < 3; retry++) {
    let response;
    try {
      response = await fetch(endpoint(settings), { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new Error('Could not reach Ollama. On the Mac run: OLLAMA_ORIGINS="*" ollama serve');
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok && !data.error) return data.message?.content || '';
    const message = String(data.error || `Ollama returned ${response.status}`);
    if (/think/i.test(message) && 'think' in body) {
      const { think, ...withoutThink } = body;
      body = withoutThink;
      continue;
    }
    if (/format/i.test(message) && body.format !== 'json') {
      body = { ...body, format: 'json' };
      continue;
    }
    throw new Error(message);
  }
  throw new Error('Ollama rejected the request.');
}

function firstObject(text) {
  const clean = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const start = clean.indexOf('{');
  if (start < 0) throw new Error('No JSON object in Ollama response');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < clean.length; i++) {
    const char = clean[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && quoted) { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === '{') depth++;
    if (!quoted && char === '}' && --depth === 0) return JSON.parse(clean.slice(start, i + 1));
  }
  throw new Error('Incomplete JSON object in Ollama response');
}

export async function interpretSketch(base64Jpeg, settings = {}) {
  if (provider(settings) === 'mock') {
    await wait(1500);
    return structuredClone(MOCK_SCENE);
  }
  let prompt = 'Convert this sketch into the scene JSON.';
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await chat(settings, { format: SCENE_SCHEMA, options: { temperature: 0.1 },
      messages: [{ role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt, images: [base64Jpeg] }] });
    try {
      const parsed = firstObject(content);
      if (!Array.isArray(parsed.bodies) || !parsed.bodies.length) throw new Error('No parts found');
      return parsed;
    } catch (error) {
      if (attempt) throw new Error(`Could not read Ollama's scene: ${error.message}`);
      prompt += ` The previous reply was invalid: ${error.message}. Return complete JSON only.`;
    }
  }
}

const TIPS = [
  'Observe how the weight seeks the earth; a longer arm may send the ball farther.',
  'A firm pivot gives the machine its courage, while a loose one steals its strength.',
  'Try a gentler pull of gravity and see how long the invention lingers in motion.',
  'The path of the moving part reveals where my timber must be strengthened.',
];

export async function askLeonardo(scene, stats, settings = {}) {
  if (provider(settings) === 'mock') return TIPS[Math.floor(Math.random() * TIPS.length)];
  const content = await chat(settings, { messages: [
    { role: 'system', content: "Speak in Leonardo da Vinci's voice. Give 2–3 concise sentences of practical advice about the machine and its motion. Return plain text only." },
    { role: 'user', content: `Machine: ${JSON.stringify(scene)}\nMotion statistics: ${JSON.stringify(stats)}` },
  ] });
  return String(content).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
