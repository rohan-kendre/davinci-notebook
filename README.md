# Da Vinci’s Notebook

**A physics lab in a notebook. Draw it. It works.**

Students meet levers, projectiles and forces as flat diagrams. This prototype turns a sketch into an editable physics experiment: identify the parts, predict the motion, run it, measure it, and ask why it happened. Leonardo’s unfinished machines provide the inspiration; the useful outcome is a student testing their own hypothesis.

## Run on your laptop

No npm install or build step is required. Use a current desktop Chrome, Edge, Firefox or Safari browser.

```sh
git clone https://github.com/rohan-kendre/davinci-notebook.git
cd davinci-notebook
python3 -m http.server 8000 --bind 127.0.0.1
```

Open **http://localhost:8000/**. On Windows, use `py -m http.server 8000 --bind 127.0.0.1`.

For real image interpretation, create a [Gemini API key in Google AI Studio](https://aistudio.google.com/app/apikey). In **Settings**, select **Gemini API**, paste the key, keep `gemini-3.8-flash` as the model, choose **Test connection**, then **Save**. Gemini processes the sketch and generates a scene; Ask Leonardo uses the same API. API usage may count against your project's quota or billing plan. The model name is editable if your account provides a different image-capable Gemini model.

The key is saved in this browser's localStorage so the setting survives refresh. Use a restricted key and a trusted computer; this static prototype has no backend to conceal a browser-side key. Sketch images are sent to the Gemini API only when **Interpret sketch** is clicked. Do not commit the key to the repository or share a browser profile containing it.

**Mock** needs no API key. It intentionally returns the same sample lever for every image; it is a labelled demonstration, not image recognition. Use **Try a sample sketch** with Mock so the outlines match. Gallery experiments also work without AI. JavaScript libraries and Google Fonts are loaded from CDNs, so a fresh page load still needs internet access; Mock is not a fully offline installation bundle.

## Your first experiment

1. Open **Draw**, choose **Try a sample sketch**, then **Interpret sketch**.
2. Check the outlines against the drawing. In the parts list, correct the shape, material and Fixed setting. Ground and supports stay fixed; the lever and ball should move.
3. Before pressing **Breathe life**, predict which end of the lever will move down and where the ball will go.
4. Run, pause and reset the simulation. Read horizontal displacement, maximum rise and top speed. Ask Leonardo for an explanation and a suggested experiment.
5. Change **one variable**—for example gravity—reset, and compare the result with your prediction. Slow motion helps inspection; it is not a different gravitational field.

For your own sketch, use thick dark lines on a light background. Separate the moving parts and mark pivots clearly. A photo should face the camera squarely. Upload, drag-and-drop and camera frames are fitted without stretching; drawing over the image is supported. Verify AI outlines before treating the result as an experiment.

## Three classroom activities

| Question | Predict | Change and measure |
| --- | --- | --- |
| Why does a lever turn? | Which side has the larger turning effect about the pivot? | Draw the pivot nearer one end; compare the direction of motion and the ball’s displacement. |
| What changes on the Moon? | Will the same starting arrangement move more slowly? | Reset at Earth and Moon gravity; compare motion, maximum rise and peak speed. Keep the geometry and materials fixed. |
| How does material change a collision? | Which ball will bounce more: stone or rubber? | Change only the ball’s material in Interpret, rerun, and compare the bounce qualitatively and peak-speed readout. |

Record **prediction → changed variable → observation → explanation**. A mismatch between prediction and result is a reason to inspect the model and revise the explanation, not to hide the measurement.

## What the measurements mean

- **Distance:** greatest absolute horizontal displacement of the tracked part from its starting position, in metres. It is not accumulated path length.
- **Peak height:** greatest rise above that part’s starting position, in metres. A ball that only falls can correctly show `0.00 m`.
- **Top speed:** largest speed observed for the tracked part, in metres per second.
- The world is **1000 × 625 pixels**, with **100 pixels = 1 metre**, and y increases downwards.

This is a qualitative educational prototype, not a calibrated engineering tool. Recognition, friction, restitution, joints and integration are approximations. The three summary measurements do not reconstruct a full trajectory. Ask Leonardo is an explanation to examine critically, not proof of a physical claim. The 3D view, where available, visualizes the same 2D simulation; it does not add out-of-plane physics.

## How it works

```text
Sketch / image / camera
  → white 1000×625 letterbox, grayscale + contrast
  → JPEG sent to the Gemini API when Gemini is selected
  → compact scene JSON (up to eight interpreted bodies)
  → normalizeScene repairs geometry, identifiers, materials and joints
  → editable outlines and parts list
  → Matter.js simulation + ink renderer + optional Three.js view
  → measurements + a physics explanation
```

The original drawing stays unprocessed. Gemini inference runs in Google's cloud, and settings persist in browser localStorage. Image/base64 content and the API key are not printed in logs. Completion diagnostics contain only elapsed time, termination reason and generated token count.

Interpretation has one **90-second total deadline** and a structured JSON response with a **4096-token output cap**. A truncated reply produces a clear error. Ask Leonardo has a **45-second deadline** and a shorter output limit. AI errors never silently substitute the mock scene.

## If something fails during the demo

- **Cannot connect:** check the internet connection, API key, model name and **Test connection** result. Use localhost rather than opening `index.html` as a file.
- **90-second timeout:** try a simpler sketch. Never keep an audience waiting: choose Mock and the sample, or open a Gallery experiment.
- **Quota / output limit / invalid JSON:** check your Gemini API quota or reduce the sketch to a few clear parts. Do not assume a failed interpretation is correct.
- **Nothing moves:** inspect Fixed checkboxes and the pivot. A fixed assembly is supposed to remain still. Reset after a change.
- **Camera unavailable:** allow camera access for localhost, close other camera apps, or upload the image instead.
- **3D unavailable:** use 2D. The experiment and measurements do not require WebGL.

## A 60-second demonstration

- **0–10 s:** “Students see physics on paper. What if that diagram could become an experiment?” Show the notebook and sample sketch.
- **10–25 s:** Interpret, identify the lever, ball and pivot, and ask the audience which way it will turn. Use the labelled Mock sample if local inference is slow; do not present it as live recognition.
- **25–40 s:** Breathe life, pause, point to the measurements, then change gravity and reset.
- **40–55 s:** Ask Leonardo for the principle and the next experiment. Show a Gallery machine if time permits.
- **55–60 s:** “Predict, test, measure, explain—a physics lab in a notebook.”

Before presenting, load the page and model, run this sequence twice on the demo laptop, and record a backup video. Keep a working 2D Gallery experiment available.

## Credits

- [Matter.js](https://brm.io/matter-js/) — rigid-body physics, MIT license.
- [Three.js](https://threejs.org/) — optional 3D visualization, MIT license.
- [Gemini API](https://ai.google.dev/gemini-api/docs) — cloud image understanding, structured scene output and explanations; usage is governed by Google's terms and your API plan.
- [Google Fonts](https://fonts.google.com/) — IM Fell English, EB Garamond, Caveat and Space Mono, under their respective open font licenses.
- Leonardo da Vinci drawings in `assets/leonardo/`, sourced via [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Drawings_by_Leonardo_da_Vinci); original works are public domain. The repository currently does not record individual Commons file-page URLs.

The scene format, module interfaces and shared styling vocabulary are documented in `CONTRACT.md`.
