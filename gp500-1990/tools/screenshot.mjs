/**
 * Headless Browser Real-Shader & Screenshot Verification Tool for 500cc Grand Prix '90
 * Starts server.js and drives headless Chrome/Edge via DevTools Protocol (CDP) in the same process.
 *
 * Usage: node c:\projects\game\gp500-1990\tools\screenshot.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_OUTPUT_DIR = 'C:\\Users\\urikt\\.gemini\\antigravity\\brain\\9bad8496-f03f-45ed-8035-6adebb866989\\scratch\\shots';
const LOCAL_FALLBACK_DIR = 'C:\\Users\\urikt\\.gemini\\antigravity\\brain\\290a2be5-0272-4699-ae1a-0a6531a19e63\\scratch\\shots';

function resolveOutputDir() {
  if (process.env.SHOTS_DIR) {
    fs.mkdirSync(process.env.SHOTS_DIR, { recursive: true });
    return process.env.SHOTS_DIR;
  }
  const candidates = [
    DEFAULT_OUTPUT_DIR,
    LOCAL_FALLBACK_DIR,
    path.join(os.tmpdir(), 'gp500-1990-shots'),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, `.probe_${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return dir;
    } catch {
      // try next candidate
    }
  }
  throw new Error('No writable screenshot output directory found');
}

const OUTPUT_DIR = resolveOutputDir();
const PROFILE_DIR = path.join(OUTPUT_DIR, '.browser_profile');

const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowserExecutable() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No local Chrome or Edge found in: ${BROWSER_CANDIDATES.join(', ')}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.consoleLogs = [];
    this.pageErrors = [];
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (err) => reject(err);
      ws.onmessage = (event) => this._onMessage(event.data);
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Log.enable');
    await this.send('Network.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }

    if (msg.id) {
      const handler = this.pending.get(msg.id);
      if (handler) {
        this.pending.delete(msg.id);
        if (msg.error) {
          handler.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
        } else {
          handler.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args } = msg.params;
      const text = (args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
        .join(' ');
      this.consoleLogs.push({ type, text });
      if (type === 'error' || (type === 'warning' && /shader|webgl|three/i.test(text))) {
        this.consoleErrors.push(`[console.${type}] ${text}`);
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params.exceptionDetails;
      const desc =
        details?.exception?.description ||
        details?.text ||
        JSON.stringify(details);
      this.pageErrors.push(`[UncaughtException] ${desc}`);
      this.consoleErrors.push(`[UncaughtException] ${desc}`);
    } else if (msg.method === 'Log.entryAdded') {
      const entry = msg.params.entry;
      if (entry && entry.level === 'error') {
        // Ignore harmless favicon 404 if any
        if (!/favicon\.ico/i.test(entry.url || '') && !/favicon\.ico/i.test(entry.text || '')) {
          this.consoleErrors.push(`[Log.error] ${entry.text} (${entry.url || ''})`);
        }
      }
    } else if (msg.method === 'Network.responseReceived') {
      const resp = msg.params?.response;
      if (resp && resp.status >= 400 && !/favicon\.ico/i.test(resp.url || '')) {
        this.consoleErrors.push(`[HTTP ${resp.status}] ${resp.url}`);
      }
    } else if (msg.method === 'Network.loadingFailed') {
      const p = msg.params;
      if (p && !p.canceled && !/favicon\.ico/i.test(p.blockedReason || '')) {
        this.consoleErrors.push(`[Network.failed] ${p.errorText || 'load failed'} (${p.type || ''})`);
      }
    }
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `Eval exception: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`
      );
    }
    return res.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  async pressKey(code, key, keyCode) {
    await this.eval(`(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, keyCode: ${keyCode}, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, keyCode: ${keyCode}, bubbles: true }));
    })()`);
  }

  async waitFrames(count = 4) {
    await this.eval(`new Promise((resolve) => {
      let n = ${count};
      function tick() {
        if (--n <= 0) resolve(true);
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    })`);
  }

  async capturePng(filePath) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    const buf = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, buf);
    return buf.length;
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

async function launchHeadlessBrowser(executablePath) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--window-size=1280,720',
    '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--remote-debugging-port=0',
    `--user-data-dir=${PROFILE_DIR}`,
    'about:blank',
  ];

  const proc = spawn(executablePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const debugPort = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for DevTools port. stderr:\n${stderr}`));
    }, 10000);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\//);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });

    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Browser exited prematurely with code ${code}. stderr:\n${stderr}`));
    });
  });

  // Query /json/list to find the page target WebSocket URL
  let pageWsUrl = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await res.json();
      const pageTarget = targets.find((t) => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        pageWsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch {
      // retry
    }
    await sleep(100);
  }

  if (!pageWsUrl) {
    proc.kill();
    throw new Error(`Could not find page target on DevTools port ${debugPort}`);
  }

  return { proc, debugPort, pageWsUrl };
}

async function waitForRaceProgress(cdp, targetRaceSeconds = 5.0, maxWallMs = 35000) {
  const startWall = Date.now();
  while (Date.now() - startWall < maxWallMs) {
    const status = await cdp.eval(`(() => {
      const gp = window.__gp500;
      if (!gp) {
        // Fallback if __gp500 hook is not yet attached: click #btn-start-race if on menu
        const startBtn = document.getElementById('btn-start-race');
        const menu = document.getElementById('paddock-menu');
        if (startBtn && menu && !menu.classList.contains('hidden')) {
          startBtn.click();
        }
        return { hasHook: false };
      }
      const state = typeof gp.getState === 'function' ? gp.getState() : gp.state;
      const riders = typeof gp.getRiders === 'function' ? gp.getRiders() : [];
      const r0 = riders && riders[0] ? riders[0] : null;
      return {
        hasHook: true,
        state,
        fps: gp.fps ?? null,
        riderCount: riders ? riders.length : 0,
        s: r0 ? r0.s : 0,
        speedKmh: r0 ? Math.round(r0.speed * 3.6) : 0,
        totalTime: r0 ? r0.totalTime : 0,
        lapTime: r0 ? r0.lapTime : 0,
      };
    })()`);

    if (status && status.hasHook && status.state === 'RACING') {
      const raceElapsed = Math.max(status.totalTime || 0, status.lapTime || 0);
      if (raceElapsed >= targetRaceSeconds || status.s >= 180) {
        return status;
      }
    }
    await sleep(250);
  }

  // Return latest snapshot even if timeout reached
  return cdp.eval(`(() => {
    const gp = window.__gp500;
    if (!gp) return { hasHook: false };
    const state = typeof gp.getState === 'function' ? gp.getState() : gp.state;
    const riders = typeof gp.getRiders === 'function' ? gp.getRiders() : [];
    const r0 = riders && riders[0] ? riders[0] : null;
    return {
      hasHook: true,
      state,
      fps: gp.fps ?? null,
      riderCount: riders ? riders.length : 0,
      s: r0 ? r0.s : 0,
      speedKmh: r0 ? Math.round(r0.speed * 3.6) : 0,
      totalTime: r0 ? r0.totalTime : 0,
      lapTime: r0 ? r0.lapTime : 0,
    };
  })()`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browserExe = findBrowserExecutable();
  console.log(`[screenshot] Using browser: ${browserExe}`);

  const { server, port, url: baseUrl } = await startServer(0);
  console.log(`[screenshot] Local GP500 server started at ${baseUrl}`);

  let browserProc = null;
  let cdp = null;

  try {
    const launched = await launchHeadlessBrowser(browserExe);
    browserProc = launched.proc;
    cdp = new CDPSession(launched.pageWsUrl);
    await cdp.connect();

    const glInfo = await cdp.eval(`(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return 'NO_WEBGL';
      return gl.getParameter(gl.VERSION) + ' | ' + gl.getParameter(gl.RENDERER);
    })()`);
    console.log(`[screenshot] Browser WebGL Context: ${glInfo}`);

    // -------------------------------------------------------------------------
    // A. Website Landing & Hero (with interactive spotlight reveal)
    // -------------------------------------------------------------------------
    const siteUrl = `${baseUrl}/`;
    console.log(`[screenshot] Navigating to ${siteUrl} ...`);
    await cdp.navigate(siteUrl);

    // Wait for __gp500, fonts, and hero/blueprint artwork to finish loading
    const siteBoot = await cdp.eval(`(async () => {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        if (window.__gp500 && window.__gp500.getShowroom && window.__gp500.getShowroom()) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const preload = (src) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ src, ok: true, width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ src, ok: false, width: 0, height: 0 });
        img.src = src;
      });
      const [heroImg, bpImg] = await Promise.all([
        preload('./assets/art/hero_gp1990.png'),
        preload('./assets/art/pitlane_blueprint.png'),
      ]);
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      return {
        hasHook: Boolean(window.__gp500),
        viewMode: window.__gp500?.getViewMode?.(),
        state: window.__gp500?.getState?.(),
        heroImg,
        bpImg,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    })()`);

    console.log(
      `[screenshot] Website boot: viewMode=${siteBoot.viewMode} state=${siteBoot.state} overflow=${siteBoot.scrollWidth > siteBoot.innerWidth} heroImg=${siteBoot.heroImg.ok}(${siteBoot.heroImg.width}x${siteBoot.heroImg.height}) bpImg=${siteBoot.bpImg.ok}(${siteBoot.bpImg.width}x${siteBoot.bpImg.height})`
    );
    if (!siteBoot.heroImg.ok || !siteBoot.bpImg.ok) {
      throw new Error(`Hero artwork failed to load: ${JSON.stringify(siteBoot)}`);
    }
    if (siteBoot.scrollWidth > siteBoot.innerWidth) {
      throw new Error(`Horizontal overflow on desktop website: scrollWidth=${siteBoot.scrollWidth} > innerWidth=${siteBoot.innerWidth}`);
    }

    // Move pointer over the right half of #hero-section to activate the X-ray CAD spotlight reveal
    const spotVars = await cdp.eval(`(async () => {
      const hero = document.getElementById('hero-section');
      const start = Date.now();
      return { initialX: hero ? hero.style.getPropertyValue('--spot-x') : '', start };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 920,
      y: 350,
    });
    const settledSpot = await cdp.eval(`(async () => {
      const hero = document.getElementById('hero-section');
      const start = Date.now();
      while (Date.now() - start < 2000) {
        const sx = parseFloat(hero ? hero.style.getPropertyValue('--spot-x') : '0');
        const sy = parseFloat(hero ? hero.style.getPropertyValue('--spot-y') : '0');
        if (sx >= 66 && Math.abs(sy - 48.6) < 6) {
          return {
            spotX: hero.style.getPropertyValue('--spot-x'),
            spotY: hero.style.getPropertyValue('--spot-y'),
            spotActive: hero.style.getPropertyValue('--spot-active'),
          };
        }
        await new Promise((r) => setTimeout(r, 60));
      }
      return {
        spotX: hero ? hero.style.getPropertyValue('--spot-x') : '',
        spotY: hero ? hero.style.getPropertyValue('--spot-y') : '',
        spotActive: hero ? hero.style.getPropertyValue('--spot-active') : '',
      };
    })()`);
    await cdp.waitFrames(4);
    console.log(`[screenshot] Hero spotlight vars: ${JSON.stringify(settledSpot)} (init=${spotVars.initialX})`);

    const shotHero = path.join(OUTPUT_DIR, 'website_hero_spotlight.png');
    const bytesHero = await cdp.capturePng(shotHero);
    console.log(`[screenshot] Saved ${shotHero} (${bytesHero} bytes)`);

    // -------------------------------------------------------------------------
    // B. Interactive 3D Showroom Section (wait for Blender GLBs to load!)
    // -------------------------------------------------------------------------
    const showroomStatus = await cdp.eval(`(async () => {
      const sec = document.getElementById('showroom-section');
      if (sec) sec.scrollIntoView({ behavior: 'instant', block: 'start' });
      const start = Date.now();
      let st = null;
      while (Date.now() - start < 15000) {
        const sr = window.__gp500?.getShowroom?.();
        st = sr ? sr.getState() : null;
        if (st && st.stageLoaded && st.trophyLoaded) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      return st;
    })()`);
    await sleep(500);
    await cdp.waitFrames(10);

    console.log(`[screenshot] 3D Showroom state: ${JSON.stringify(showroomStatus)}`);
    if (!showroomStatus?.hasWebGL || !showroomStatus?.stageLoaded || !showroomStatus?.trophyLoaded) {
      throw new Error(`3D Showroom GLB assets or WebGL failed to load: ${JSON.stringify(showroomStatus)}`);
    }

    const shotShowroom = path.join(OUTPUT_DIR, 'website_showroom_3d.png');
    const bytesShowroom = await cdp.capturePng(shotShowroom);
    console.log(`[screenshot] Saved ${shotShowroom} (${bytesShowroom} bytes)`);

    // Exercise interactive controls (Lean pose, Bike tab, Engine Rev sweep) with 0 errors
    const showroomInteractive = await cdp.eval(`(async () => {
      const shidenTab = document.querySelector('#showroom-bike-tabs [data-bike-id="shiden"]');
      if (shidenTab) shidenTab.click();
      const leanBtn = document.getElementById('btn-showroom-lean');
      if (leanBtn) leanBtn.click();
      const revBtn = document.getElementById('btn-showroom-rev');
      if (revBtn) revBtn.click();
      await new Promise((r) => setTimeout(r, 250));
      const revText = revBtn ? revBtn.textContent : '';
      if (leanBtn) leanBtn.click();
      const akagiTab = document.querySelector('#showroom-bike-tabs [data-bike-id="akagi"]');
      if (akagiTab) akagiTab.click();
      return { revText };
    })()`);
    console.log(`[screenshot] Showroom interactive check: ${JSON.stringify(showroomInteractive)}`);

    // -------------------------------------------------------------------------
    // C. Circuits & Engineering Lab Sections (scroll & inspect)
    // -------------------------------------------------------------------------
    await cdp.eval(`document.getElementById('circuits-section')?.scrollIntoView({ behavior: 'instant', block: 'start' })`);
    await sleep(450);
    await cdp.waitFrames(6);
    const circuitCheck = await cdp.eval(`(() => {
      const mTab = document.querySelector('#site-circuit-tabs [data-track-id="monterey"]');
      if (mTab) mTab.click();
      const montereyName = document.getElementById('circuit-name')?.textContent || '';
      const sTab = document.querySelector('#site-circuit-tabs [data-track-id="sakura"]');
      if (sTab) sTab.click();
      return { montereyName, sakuraName: document.getElementById('circuit-name')?.textContent || '' };
    })()`);
    await cdp.waitFrames(4);
    console.log(`[screenshot] Circuit tab check: ${JSON.stringify(circuitCheck)}`);
    const shotCircuits = path.join(OUTPUT_DIR, 'website_circuits.png');
    const bytesCircuits = await cdp.capturePng(shotCircuits);
    console.log(`[screenshot] Saved ${shotCircuits} (${bytesCircuits} bytes)`);

    await cdp.eval(`document.getElementById('engineering-section')?.scrollIntoView({ behavior: 'instant', block: 'start' })`);
    await sleep(450);
    await cdp.waitFrames(6);
    const sliderCheck = await cdp.eval(`(() => {
      const spd = document.getElementById('sim-speed-slider');
      if (!spd) return null;
      const beforeLean = document.getElementById('sim-lean-val')?.textContent || '';
      spd.value = '150';
      spd.dispatchEvent(new Event('input', { bubbles: true }));
      const afterLean = document.getElementById('sim-lean-val')?.textContent || '';
      spd.value = '125';
      spd.dispatchEvent(new Event('input', { bubbles: true }));
      return { beforeLean, afterLean };
    })()`);
    await cdp.waitFrames(4);
    console.log(`[screenshot] Engineering slider check: ${JSON.stringify(sliderCheck)}`);
    const shotEngineering = path.join(OUTPUT_DIR, 'website_engineering.png');
    const bytesEngineering = await cdp.capturePng(shotEngineering);
    console.log(`[screenshot] Saved ${shotEngineering} (${bytesEngineering} bytes)`);

    await cdp.eval(`document.getElementById('controls-section')?.scrollIntoView({ behavior: 'instant', block: 'start' })`);
    await sleep(450);
    await cdp.waitFrames(6);
    const shotControls = path.join(OUTPUT_DIR, 'website_controls.png');
    const bytesControls = await cdp.capturePng(shotControls);
    console.log(`[screenshot] Saved ${shotControls} (${bytesControls} bytes)`);

    // -------------------------------------------------------------------------
    // D. Paddock Overlay (Enter Paddock + verify showroom paused)
    // -------------------------------------------------------------------------
    const paddockState = await cdp.eval(`(() => {
      const btn = document.getElementById('btn-nav-paddock') || document.getElementById('btn-controls-paddock');
      if (btn) btn.click();
      const sr = window.__gp500?.getShowroom?.();
      const paddockEl = document.getElementById('paddock-menu');
      return {
        viewMode: window.__gp500?.getViewMode?.(),
        gameState: window.__gp500?.getState?.(),
        showroomActive: sr ? sr.getState().active : null,
        paddockVisible: paddockEl ? !paddockEl.classList.contains('hidden') : false,
      };
    })()`);
    await sleep(400);
    await cdp.waitFrames(8);

    console.log(`[screenshot] Paddock state: ${JSON.stringify(paddockState)}`);
    if (!paddockState.paddockVisible || paddockState.showroomActive !== false) {
      throw new Error(`Paddock transition failed: ${JSON.stringify(paddockState)}`);
    }

    const shotPaddock = path.join(OUTPUT_DIR, 'paddock_overlay.png');
    const bytesPaddock = await cdp.capturePng(shotPaddock);
    console.log(`[screenshot] Saved ${shotPaddock} (${bytesPaddock} bytes)`);

    // Verify BACK TO WEBSITE resumes showroom cleanly
    const roundTripState = await cdp.eval(`(() => {
      const backBtn = document.getElementById('btn-paddock-home');
      if (backBtn) backBtn.click();
      const sr = window.__gp500?.getShowroom?.();
      return {
        viewMode: window.__gp500?.getViewMode?.(),
        showroomActive: sr ? sr.getState().active : null,
      };
    })()`);
    console.log(`[screenshot] Paddock -> Website round-trip: ${JSON.stringify(roundTripState)}`);
    if (roundTripState.viewMode !== 'site' || roundTripState.showroomActive !== true) {
      throw new Error(`Back to Website round-trip failed: ${JSON.stringify(roundTripState)}`);
    }

    // -------------------------------------------------------------------------
    // 1. Race at ~8s Horizontal Split
    // -------------------------------------------------------------------------
    const raceUrl = `${baseUrl}/?autostart=1&mode=gp&track=sakura&split=horizontal&demo=1`;
    console.log(`[screenshot] Navigating to ${raceUrl} ...`);
    await cdp.navigate(raceUrl);

    // Wait until ~8s total session time (~3.2s countdown + ~5.5s racing)
    const statusHoriz = await waitForRaceProgress(cdp, 5.5, 40000);
    await cdp.waitFrames(4);

    const shotHorizontal = path.join(OUTPUT_DIR, 'race_horizontal_split.png');
    const bytesHoriz = await cdp.capturePng(shotHorizontal);
    console.log(
      `[screenshot] Saved ${shotHorizontal} (${bytesHoriz} bytes) | state=${statusHoriz?.state} s=${statusHoriz?.s?.toFixed?.(1)}m speed=${statusHoriz?.speedKmh}km/h fps=${statusHoriz?.fps}`
    );

    // -------------------------------------------------------------------------
    // 2. Vertical Split
    // -------------------------------------------------------------------------
    await cdp.pressKey('KeyV', 'v', 86);
    await cdp.waitFrames(6);
    const shotVertical = path.join(OUTPUT_DIR, 'race_vertical_split.png');
    const bytesVert = await cdp.capturePng(shotVertical);
    console.log(`[screenshot] Saved ${shotVertical} (${bytesVert} bytes)`);

    // Toggle back to horizontal split
    await cdp.pressKey('KeyV', 'v', 86);
    await cdp.waitFrames(3);

    // -------------------------------------------------------------------------
    // 3. Helmet Cam
    // -------------------------------------------------------------------------
    // Cycle P1 camera: 'chase' -> 'chase-far' -> 'helmet' (2 presses of KeyC)
    await cdp.pressKey('KeyC', 'c', 67);
    await cdp.waitFrames(2);
    await cdp.pressKey('KeyC', 'c', 67);
    await cdp.waitFrames(6);

    const shotHelmet = path.join(OUTPUT_DIR, 'helmet_cam.png');
    const bytesHelmet = await cdp.capturePng(shotHelmet);
    console.log(`[screenshot] Saved ${shotHelmet} (${bytesHelmet} bytes)`);

    // Cycle P1 camera back to 'chase' (1 press of KeyC)
    await cdp.pressKey('KeyC', 'c', 67);
    await cdp.waitFrames(3);

    // -------------------------------------------------------------------------
    // 4. Close Look at a Bike (Single Full-Screen Viewport on Track)
    // -------------------------------------------------------------------------
    const soloUrl = `${baseUrl}/?autostart=1&mode=solo&track=sakura&split=horizontal&demo=1`;
    console.log(`[screenshot] Navigating to ${soloUrl} for full-screen close bike view...`);
    await cdp.navigate(soloUrl);
    const statusSolo = await waitForRaceProgress(cdp, 3.5, 30000);
    await cdp.waitFrames(4);

    const shotBikeCloseup = path.join(OUTPUT_DIR, 'bike_closeup.png');
    const bytesCloseup = await cdp.capturePng(shotBikeCloseup);
    console.log(
      `[screenshot] Saved ${shotBikeCloseup} (${bytesCloseup} bytes) | s=${statusSolo?.s?.toFixed?.(1)}m speed=${statusSolo?.speedKmh}km/h fps=${statusSolo?.fps}`
    );

    // -------------------------------------------------------------------------
    // 5. Replay TV Cam
    // -------------------------------------------------------------------------
    // Trigger race completion so the Results screen appears, then click Watch Replay
    const replayEntered = await cdp.eval(`(async () => {
      const gp = window.__gp500;
      if (gp && typeof gp.startReplay === 'function') {
        gp.startReplay();
        return 'hook:startReplay';
      }
      if (gp && typeof gp.getRiders === 'function') {
        const riders = gp.getRiders();
        riders.forEach((r, idx) => {
          r.finished = true;
          r.finishPosition = idx + 1;
        });
      }
      // Wait up to 2.5s for results overlay & watch replay button
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const btn =
          document.getElementById('btn-watch-replay') ||
          Array.from(document.querySelectorAll('button')).find((b) =>
            /replay/i.test(b.textContent || '')
          );
        if (btn) {
          btn.click();
          return 'clicked:' + (btn.id || btn.textContent.trim());
        }
      }
      return 'no-replay-btn';
    })()`);

    await sleep(600);
    await cdp.waitFrames(8);

    const shotReplayTv = path.join(OUTPUT_DIR, 'replay_tv_cam.png');
    const bytesReplay = await cdp.capturePng(shotReplayTv);
    console.log(
      `[screenshot] Saved ${shotReplayTv} (${bytesReplay} bytes) | replayTrigger=${replayEntered}`
    );

    // -------------------------------------------------------------------------
    // Final FPS & Console Error Summary
    // -------------------------------------------------------------------------
    const finalFps = await cdp.eval(`window.__gp500 ? window.__gp500.fps : null`);
    console.log(`\n[screenshot] Observed window.__gp500.fps: ${finalFps ?? statusHoriz?.fps ?? 'N/A'}`);

    if (cdp.consoleErrors.length > 0) {
      console.error(`\n[screenshot] Console / Page Errors (${cdp.consoleErrors.length}):`);
      for (const err of cdp.consoleErrors) {
        console.error(`  - ${err}`);
      }
      process.exitCode = 1;
    } else {
      console.log('[screenshot] Browser Console Errors: 0 (CLEAN)');
    }
  } finally {
    cdp?.close();
    if (browserProc) {
      try {
        browserProc.kill();
      } catch {
        // ignore
      }
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error('[screenshot] Fatal error:', err);
  process.exit(1);
});
