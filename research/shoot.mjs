// Drives headless Chrome over the DevTools protocol to verify the built page:
// desktop and phone viewports, 2D and 3D map modes, screenshots and console log.
//   node research/shoot.mjs            (preview server should already be running)
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

// Set CHROME_PATH to your Chrome/Chromium executable.
const CHROME = process.env.CHROME_PATH ?? 'chrome';
const URL_BASE = process.env.SHOOT_URL ?? 'http://127.0.0.1:5199/';
const OUT = new URL('./shots/', import.meta.url);
const PORT = 9333;

await mkdir(OUT, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--no-first-run',
  '--user-data-dir=' + new URL('./shots/chrome-profile', import.meta.url).pathname.slice(1),
  'about:blank',
], { stdio: 'ignore' });

async function endpoint(path) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (response.ok) return await response.json();
    } catch { /* Chrome is still starting. */ }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint did not answer.');
}

const targets = await endpoint('/json/list');
const page = targets.find((target) => target.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const consoleLog = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  } else if (message.method === 'Runtime.consoleAPICalled') {
    consoleLog.push(`${message.params.type}: ${message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`);
  } else if (message.method === 'Runtime.exceptionThrown') {
    consoleLog.push(`EXCEPTION: ${message.params.exceptionDetails.text} ${message.params.exceptionDetails.exception?.description ?? ''}`);
  }
});

function send(method, params = {}) {
  const id = (nextId += 1);
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function setViewport(width, height, mobile, deviceScaleFactor = 1) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor, mobile,
    screenWidth: width, screenHeight: height,
  });
}

async function shoot(name, { fullPage = false } = {}) {
  const params = { format: 'png' };
  if (fullPage) params.captureBeyondViewport = true;
  const { data } = await send('Page.captureScreenshot', params);
  await writeFile(new URL(name, OUT), Buffer.from(data, 'base64'));
  console.log(`saved ${name}`);
}

async function goto(url, waitMs = 3500) {
  await send('Page.navigate', { url });
  await sleep(waitMs);
}

async function selectPeriod(label) {
  await evaluate(`(() => { const b = [...document.querySelectorAll(".period-tabs button")].find((item) => item.textContent.trim() === ${JSON.stringify(label)}); if (b) { b.click(); return true; } return false; })()`);
  await sleep(900);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

// 1. desktop, 2D (default when WebGL is missing) and full page
await setViewport(1440, 1000, false);
await goto(`${URL_BASE}?debug=grid`);
console.log('webgl:', await evaluate('(() => { const c = document.createElement("canvas"); return Boolean(c.getContext("webgl2") || c.getContext("webgl")); })()'));
console.log('mode buttons:', await evaluate('[...document.querySelectorAll(".map-mode-switch button")].map((b) => b.textContent.trim() + (b.disabled ? " (disabled)" : "")).join(" | ")'));
await shoot('desktop-2d-top.png');
await evaluate('document.querySelector(".explorer").scrollIntoView({block: "start"})');
await sleep(600);
await shoot('desktop-2d-map.png');

// 1b. this week has events on mapped venues, so pins must appear
await selectPeriod('Bu hafta');
console.log('week pins (2D):', await evaluate('[...document.querySelectorAll(".map-pin-2d")].filter((p) => p.offsetParent !== null).length'));
console.log('hint:', await evaluate('document.querySelector(".map-hint")?.textContent?.trim()'));
await shoot('desktop-2d-week-pins.png');

// 2. switch to 3D if the browser can render it
const clicked = await evaluate('(() => { const b = [...document.querySelectorAll(".map-mode-switch button")].find((item) => item.textContent.includes("3D")); if (b && !b.disabled) { b.click(); return true; } return false; })()');
console.log('3D clicked:', clicked);
if (clicked) {
  await sleep(9000);
  console.log('canvas present:', await evaluate('Boolean(document.querySelector(".map-3d canvas"))'));
  console.log('canvas size:', await evaluate('(() => { const c = document.querySelector(".map-3d canvas"); return c ? c.width + "x" + c.height : "none"; })()'));
  console.log('camera:', await evaluate('window.__campusCamera ?? "(no report)"'));
  console.log('pins visible:', await evaluate('[...document.querySelectorAll(".map-pin-3d")].filter((p) => p.style.display !== "none").length'));
  await evaluate('document.querySelector(".map-viewport").scrollIntoView({block: "center"})');
  await sleep(800);
  await shoot('desktop-3d.png');
  // 3D with a venue selected: the camera must fly to the building and mark it
  await evaluate('[...document.querySelectorAll(".map-pin-3d")].filter((p) => p.style.display !== "none")[0]?.click()');
  await sleep(4000);
  console.log('selected venue:', await evaluate('document.querySelector(".events-heading h2")?.textContent?.trim()'));
  await shoot('desktop-3d-selected.png');
}

// 3. event detail through a direct link, desktop: a mapped venue must show its name,
// an unmapped one must say so, and the link must work without the live API.
const mappedId = await evaluate('fetch("/events.json").then((r) => r.json()).then((d) => (d.events.find((e) => e.venueId && ["akm","cagdas-muze","sinema","turizm","emyo","ogrenci-merkezi","kutuphane"].includes(e.venueId)) ?? d.events[0]).id)');
await goto(`${URL_BASE}?etkinlik=${mappedId}`);
await sleep(2500);
console.log('dialog open:', await evaluate('Boolean(document.querySelector(".event-dialog[open]"))'));
console.log('dialog place:', await evaluate('document.querySelector(".dialog-facts")?.textContent?.trim().slice(0, 160)'));
console.log('dialog note:', await evaluate('document.querySelector(".dialog-note")?.textContent?.trim() ?? "(none)"'));
await shoot('desktop-dialog.png');

// 4. phone viewport
await setViewport(390, 844, true, 2);
await goto(`${URL_BASE}?debug=grid`);
await selectPeriod('Bu hafta');
await evaluate('document.querySelector(".explorer").scrollIntoView({block: "start"})');
await sleep(800);
await shoot('phone-map.png');
await evaluate('window.scrollTo(0, 0)');
await sleep(400);
await shoot('phone-top.png');
console.log('phone pin overlap check:', await evaluate(`(() => {
  const pins = [...document.querySelectorAll(".map-pin")].filter((p) => p.offsetParent !== null);
  const boxes = pins.map((p) => p.getBoundingClientRect());
  let overlapping = 0;
  const pairs = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]; const b = boxes[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        overlapping += 1;
        pairs.push(pins[i].getAttribute("aria-label") + " / " + pins[j].getAttribute("aria-label"));
      }
    }
  }
  return pins.length + " pins, " + overlapping + " overlapping pairs " + pairs.join("; ");
})()`));
// 5. phone in 3D
const phone3d = await evaluate('(() => { const b = [...document.querySelectorAll(".map-mode-switch button")].find((item) => item.textContent.includes("3D")); if (b && !b.disabled) { b.click(); return true; } return false; })()');
if (phone3d) {
  await sleep(8000);
  await evaluate('document.querySelector(".map-viewport").scrollIntoView({block: "center"})');
  await sleep(600);
  await shoot('phone-3d.png');
}

console.log('--- console log ---');
console.log(consoleLog.slice(0, 40).join('\n') || '(empty)');

socket.close();
chrome.kill();
