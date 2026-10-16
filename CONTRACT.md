# Da Vinci's Notebook — shared contract
Plain HTML/CSS/JS ES modules, no npm, no build step. Run with: py -m http.server 8000 (Windows) or python3 -m http.server 8000 (Mac).
Matter.js 0.19.0 is a global from https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js

## File ownership
All files are now built by a single developer on one laptop. Keep module interfaces and class names stable.

## World
1000 x 625 px. Every sketch is letterboxed onto a white 1000x625 canvas, so AI pixel coordinates = world coordinates. Scale: 100 px = 1 m.

## Scene JSON
{
  "title": "string",
  "bodies": [{
    "id": "string", "label": "string",
    "shape": "circle" | "rect" | "polygon",
    "x": number, "y": number,                            // centre (circle/rect)
    "radius": number,                                     // circle
    "width": number, "height": number, "angle": number,   // rect, degrees
    "vertices": [[x,y], ...],                             // polygon, convex, world coords
    "material": "wood"|"stone"|"metal"|"rubber"|"cloth"|"earth",
    "static": boolean, "mass": number (optional, kg), "projectile": boolean (optional)
  }],
  "joints": [
    {"type":"hinge","a":"id","b":"id"|null,"x":n,"y":n},     // b null = pinned to world
    {"type":"rope"|"spring","a":"id","b":"id"|null,"ax":n,"ay":n,"bx":n,"by":n},
    {"type":"weld","a":"id","b":"id"}
  ],
  "motors": [{"body":"id","speed":number}],               // rad/s
  "velocities": [{"body":"id","vx":number,"vy":number}],  // px/s
  "note": "string"
}

## Module interfaces
scene.js   (A) export function normalizeScene(raw) -> scene   // repairs; throws only if zero bodies
ai.js      (A) export async function interpretSketch(base64Jpeg, settings) -> raw scene JSON
               export async function askLeonardo(scene, stats, settings) -> string
capture.js (A) export function setupDrawPad(canvas) -> {clear(), undo(), drawSample(), getCanvas()}
               export async function toSketch(source) -> {canvas, base64}   // File | HTMLVideoElement | HTMLCanvasElement
physics.js (B) export function createSim(scene, {gravity:1, timeScale:1}) ->
               {engine, bodies, joints, scene, step(), reset(), setGravity(g), setTimeScale(s), getStats(), destroy(), attachMouse(canvas)}
               getStats() -> {distance, peak, topSpeed}   // m, m, m/s
render.js  (B) export function createRenderer(canvas, sim, {sketchImage, showLabels, showSketch}) -> {draw(), set(option, value)}
gallery.js (B) export const PRESETS = [{id, title, source, image, blurb, scene}]
view3d.js  (B) export function createView3D(container, sim) -> {start(), stop()}   // stretch goal

Animation loop lives in app.js: requestAnimationFrame → sim.step() → renderer.draw().
Simulation canvas: <canvas id="sim-canvas" width="1000" height="625"></canvas>

## Shared CSS class names (A writes the HTML, B styles it)
Layout: .app-header, .brand, .tagline, .folio-tabs, .folio-tab (.is-active), .screen (.is-active), .stage, .side-panel, .paper
Buttons: .btn, .btn-primary, .btn-ghost, .chip, .icon-btn
Draw: .draw-pad, .pad-tools, .sample-btn
Interpret: .parts-list, .part-row, .part-tag, .part-material, .part-fixed, .part-delete
Live: .controls, .slider, .stats, .stat, .stat-value, .stat-label
Leonardo: .margin-note, .mirror
Gallery: .gallery-grid, .gallery-card, .gallery-thumb, .gallery-meta, .source
Feedback: .loading-overlay (.is-visible), .quill, .loading-text, .toast (.is-visible, .is-error), .modal (.is-open)
Look: parchment #F1E6CC, paper #FBF5E6, ink #3B2A1A, sienna #8B3E1C, gold #B08D57. IM Fell English titles, EB Garamond body, Caveat handwriting, Space Mono labels.