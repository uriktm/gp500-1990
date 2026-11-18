/**
 * End-to-End Headless WebRTC Online 1v1 Duel Verification Tool for 500cc Grand Prix '90
 * Starts server.js, launches TWO separate headless Chrome browser windows/processes (Host & Guest),
 * verifies signaling (/api/room), real WebRTC DataChannel connection, lobby READY/START,
 * owner-authoritative KeyW racing sync (> 25m on both local & proxy bikes), visibilitychange
 * OPPONENT AWAY banner, 0 console/page/HTTP errors, and saves verification screenshots.
 *
 * Usage: node c:\projects\game\gp500-1990\tools\verify_online_webrtc.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../server.js';

const DEFAULT_OUTPUT_DIR = 'C:\\Users\\urikt\\.gemini\\antigravity\\brain\\9bad8496-f03f-45ed-8035-6adebb866989\\scratch\\shots';
const LOCAL_FALLBACK_DIR = 'C:\\Users\\urikt\\.gemini\\antigravity\\brain\\bcd4e81f-6c26-4737-b4e6-1d3c0fb0619d\\scratch\\shots';

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

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

class CDPSession {
  constructor(wsUrl, label = 'page') {
    this.wsUrl = wsUrl;
    this.label = label;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.consoleLogs = [];
    this.pageErrors = [];
    this.httpErrors = [];
  }

  async connect(isPageTarget = true) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (err) => reject(err);
      ws.onmessage = (event) => this._onMessage(event.data);
    });

    if (isPageTarget) {
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
          handler.reject(new Error(`[${this.label}] ${msg.error.message} (${JSON.stringify(msg.error)})`));
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
        this.consoleErrors.push(`[${this.label} console.${type}] ${text}`);
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const details = msg.params.exceptionDetails;
      const desc =
        details?.exception?.description ||
        details?.text ||
        JSON.stringify(details);
      this.pageErrors.push(`[${this.label} UncaughtException] ${desc}`);
      this.consoleErrors.push(`[${this.label} UncaughtException] ${desc}`);
    } else if (msg.method === 'Log.entryAdded') {
      const entry = msg.params.entry;
      if (entry && entry.level === 'error') {
        if (!/favicon\.ico/i.test(entry.url || '') && !/favicon\.ico/i.test(entry.text || '')) {
          this.consoleErrors.push(`[${this.label} Log.error] ${entry.text} (${entry.url || ''})`);
        }
      }
    } else if (msg.method === 'Network.responseReceived') {
      const resp = msg.params?.response;
      if (resp && resp.status >= 400 && !/favicon\.ico/i.test(resp.url || '')) {
        const msgStr = `[${this.label} HTTP ${resp.status}] ${resp.url}`;
        this.httpErrors.push(msgStr);
        this.consoleErrors.push(msgStr);
      }
    } else if (msg.method === 'Network.loadingFailed') {
      const p = msg.params;
      if (p && !p.canceled && !/favicon\.ico/i.test(p.blockedReason || '')) {
        const msgStr = `[${this.label} Network.failed] ${p.errorText || 'load failed'} (${p.type || ''})`;
        this.httpErrors.push(msgStr);
        this.consoleErrors.push(msgStr);
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
        `[${this.label}] Eval exception: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`
      );
    }
    return res.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  async dispatchKey(type, code, key, keyCode) {
    await this.send('Input.dispatchKeyEvent', {
      type,
      code,
      key,
      text: type === 'keyDown' && key.length === 1 ? key : '',
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    });
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

async function launchIsolatedBrowser(executablePath, profileDir, label) {
  fs.mkdirSync(profileDir, { recursive: true });

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
    '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--window-size=1280,720',
    '--force-device-scale-factor=1',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ];

  const proc = spawn(executablePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const { debugPort, browserWsUrl } = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      reject(new Error(`[${label}] Timed out waiting for DevTools port. stderr:\n${stderr}`));
    }, 10000);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/(ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ browserWsUrl: match[1], debugPort: Number(match[2]) });
      }
    });

    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`[${label}] Browser exited prematurely with code ${code}. stderr:\n${stderr}`));
    });
  });

  let pageTarget = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await res.json();
      pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (pageTarget) break;
    } catch {
      // retry
    }
    await sleep(100);
  }

  if (!pageTarget) {
    proc.kill();
    throw new Error(`[${label}] Could not find page target on DevTools port ${debugPort}`);
  }

  return {
    proc,
    debugPort,
    browserWsUrl,
    targetId: pageTarget.id,
    pageWsUrl: pageTarget.webSocketDebuggerUrl,
  };
}

async function waitUntil(description, fn, timeoutMs = 20000, pollMs = 150) {
  const start = Date.now();
  let lastVal = null;
  while (Date.now() - start < timeoutMs) {
    lastVal = await fn();
    if (lastVal && lastVal.ok) {
      return lastVal;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${description} (last=${JSON.stringify(lastVal)})`);
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gp500-webrtc-'));
  const hostProfileDir = path.join(tempRoot, 'host-profile');
  const guestProfileDir = path.join(tempRoot, 'guest-profile');

  const browserExe = findBrowserExecutable();
  console.log(`[webrtc] Using browser: ${browserExe}`);

  const { server, url: baseUrl } = await startServer(0);
  console.log(`[webrtc] Local GP500 server started at ${baseUrl}`);

  let hostBrowser = null;
  let guestBrowser = null;
  let hostCdp = null;
  let guestCdp = null;
  let guestBrowserCdp = null;

  try {
    const [hLaunched, gLaunched] = await Promise.all([
      launchIsolatedBrowser(browserExe, hostProfileDir, 'HostBrowser'),
      launchIsolatedBrowser(browserExe, guestProfileDir, 'GuestBrowser'),
    ]);
    hostBrowser = hLaunched;
    guestBrowser = gLaunched;

    hostCdp = new CDPSession(hostBrowser.pageWsUrl, 'Host');
    guestCdp = new CDPSession(guestBrowser.pageWsUrl, 'Guest');
    guestBrowserCdp = new CDPSession(guestBrowser.browserWsUrl, 'GuestCtrl');

    await Promise.all([
      hostCdp.connect(true),
      guestCdp.connect(true),
      guestBrowserCdp.connect(false),
    ]);

    // -------------------------------------------------------------------------
    // 1. Host navigates to /, opens Online Lobby, clicks CREATE ROOM
    // -------------------------------------------------------------------------
    console.log(`[webrtc] Host navigating to ${baseUrl}/ ...`);
    await hostCdp.navigate(`${baseUrl}/`);

    await waitUntil('Host __gp500 and #btn-nav-online ready', () =>
      hostCdp.eval(`(() => {
        const gp = window.__gp500;
        const btn = document.getElementById('btn-nav-online');
        return { ok: Boolean(gp && btn) };
      })()`)
    );

    const lobbyOpened = await hostCdp.eval(`(() => {
      document.getElementById('btn-nav-online').click();
      const ov = document.getElementById('online-lobby-overlay');
      return {
        visible: Boolean(ov && !ov.classList.contains('hidden')),
        btnCreateExists: Boolean(document.getElementById('btn-online-create'))
      };
    })()`);
    assert(lobbyOpened.visible && lobbyOpened.btnCreateExists, `Host lobby failed to open: ${JSON.stringify(lobbyOpened)}`);

    await hostCdp.eval(`document.getElementById('btn-online-create').click()`);

    const roomCreated = await waitUntil('Host room code & waiting phase', () =>
      hostCdp.eval(`(() => {
        const st = window.__gp500?.getOnlineState?.();
        const codeText = (document.getElementById('online-room-code')?.textContent || '').trim();
        const valid = /^[A-Z0-9]{5}$/.test(codeText) && st?.phase === 'waiting';
        return { ok: valid, code: codeText, st };
      })()`),
      15000
    );
    const roomCode = roomCreated.code;
    console.log(`[webrtc] Host created room ${roomCode} (phase=${roomCreated.st.phase})`);

    // -------------------------------------------------------------------------
    // 2. Guest navigates to /?room=XXXXX
    // -------------------------------------------------------------------------
    const guestUrl = `${baseUrl}/?room=${roomCode}`;
    console.log(`[webrtc] Guest navigating to ${guestUrl} ...`);
    await guestCdp.navigate(guestUrl);

    const guestOpened = await waitUntil('Guest auto-opened Join lobby with room code prefilled', () =>
      guestCdp.eval(`(() => {
        const gp = window.__gp500;
        const ov = document.getElementById('online-lobby-overlay');
        const joinPanel = document.getElementById('online-panel-guest');
        const joinVal = (document.getElementById('online-join-code')?.value || '').trim().toUpperCase();
        const ok = Boolean(gp && ov && !ov.classList.contains('hidden') && joinPanel && !joinPanel.classList.contains('hidden') && joinVal === ${JSON.stringify(roomCode)});
        return {
          ok,
          readyState: document.readyState,
          href: location.href,
          hasGp: Boolean(gp),
          ovHidden: ov ? ov.classList.contains('hidden') : null,
          joinHidden: joinPanel ? joinPanel.classList.contains('hidden') : null,
          joinVal,
          onlineState: gp?.getOnlineState?.() || null
        };
      })()`),
      20000
    );
    console.log(`[webrtc] Guest lobby opened on Join tab with code=${guestOpened.joinVal}`);

    // -------------------------------------------------------------------------
    // 3. Wait for real WebRTC DataChannel Connected on BOTH sides
    // -------------------------------------------------------------------------
    const connectedPair = await waitUntil('Both Host and Guest WebRTC DataChannels Connected', async () => {
      const [h, g] = await Promise.all([
        hostCdp.eval(`(() => ({
          st: window.__gp500?.getOnlineState?.(),
          pillPhase: document.getElementById('online-status-pill')?.getAttribute('data-phase'),
          pillText: document.getElementById('online-status-text')?.textContent || ''
        }))()`),
        guestCdp.eval(`(() => ({
          st: window.__gp500?.getOnlineState?.(),
          pillPhase: document.getElementById('online-status-pill')?.getAttribute('data-phase'),
          pillText: document.getElementById('online-status-text')?.textContent || ''
        }))()`),
      ]);
      const validTypes = new Set(['host', 'srflx', 'prflx', 'relay']);
      const hOk = h?.st?.phase === 'connected' && h?.st?.peerConnected && validTypes.has(h?.st?.transportType);
      const gOk = g?.st?.phase === 'connected' && g?.st?.peerConnected && validTypes.has(g?.st?.transportType);
      return { ok: Boolean(hOk && gOk), host: h, guest: g };
    }, 20000);

    console.log(
      `[webrtc] DataChannels connected! Host=${connectedPair.host.st.transportType} (${connectedPair.host.pillText}) | Guest=${connectedPair.guest.st.transportType} (${connectedPair.guest.pillText})`
    );

    // -------------------------------------------------------------------------
    // 4. Guest clicks READY -> Host clicks START ONLINE DUEL
    // -------------------------------------------------------------------------
    await waitUntil('Guest READY button enabled', () =>
      guestCdp.eval(`(() => {
        const btn = document.getElementById('btn-online-ready');
        return { ok: Boolean(btn && !btn.disabled) };
      })()`)
    );
    await guestCdp.eval(`document.getElementById('btn-online-ready').click()`);

    await waitUntil('Host sees Guest READY and START ONLINE DUEL enabled', () =>
      hostCdp.eval(`(() => {
        const st = window.__gp500?.getOnlineState?.();
        const startBtn = document.getElementById('btn-online-start');
        return { ok: Boolean(st?.guestReady && startBtn && !startBtn.disabled), st };
      })()`),
      10000
    );

    await hostCdp.waitFrames(4);
    const shotLobby = path.join(OUTPUT_DIR, 'online_lobby.png');
    const bytesLobby = await hostCdp.capturePng(shotLobby);
    console.log(`[webrtc] Saved ${shotLobby} (${bytesLobby} bytes)`);

    await hostCdp.eval(`document.getElementById('btn-online-start').click()`);
    console.log('[webrtc] Host clicked START ONLINE DUEL; waiting for synchronized countdown -> RACING ...');

    // -------------------------------------------------------------------------
    // 5. Verify BOTH tabs enter RACING with fullscreen single viewport & net badge
    // -------------------------------------------------------------------------
    const racingEntry = await waitUntil('Both Host and Guest enter RACING state', async () => {
      const [h, g] = await Promise.all([
        hostCdp.eval(`(() => ({
          state: window.__gp500?.getState?.(),
          hidden: document.hidden,
          split: document.getElementById('race-hud')?.getAttribute('data-split'),
          badgeHidden: document.getElementById('online-net-badge')?.classList.contains('hidden'),
          badgeText: document.getElementById('online-net-badge')?.textContent || '',
          online: window.__gp500?.getOnlineState?.()
        }))()`),
        guestCdp.eval(`(() => ({
          state: window.__gp500?.getState?.(),
          hidden: document.hidden,
          split: document.getElementById('race-hud')?.getAttribute('data-split'),
          badgeHidden: document.getElementById('online-net-badge')?.classList.contains('hidden'),
          badgeText: document.getElementById('online-net-badge')?.textContent || '',
          online: window.__gp500?.getOnlineState?.()
        }))()`),
      ]);
      return { ok: h?.state === 'RACING' && g?.state === 'RACING', host: h, guest: g };
    }, 25000);

    assert(racingEntry.host.split === 'single' && !racingEntry.host.badgeHidden, `Host HUD invalid: ${JSON.stringify(racingEntry.host)}`);
    assert(racingEntry.guest.split === 'single' && !racingEntry.guest.badgeHidden, `Guest HUD invalid: ${JSON.stringify(racingEntry.guest)}`);
    assert(racingEntry.host.online.localRiderIndex === 0 && racingEntry.guest.online.localRiderIndex === 1, 'Expected Host localRiderIndex=0 and Guest localRiderIndex=1');
    console.log(`[webrtc] Both tabs RACING! Host badge="${racingEntry.host.badgeText}" | Guest badge="${racingEntry.guest.badgeText}"`);

    // -------------------------------------------------------------------------
    // 6. Send synthetic KeyW inputs on BOTH tabs & verify synced advancement (s > 25m)
    // -------------------------------------------------------------------------
    await Promise.all([
      hostCdp.eval(`document.activeElement?.blur?.(); window.focus();`),
      guestCdp.eval(`document.activeElement?.blur?.(); window.focus();`),
    ]);

    await Promise.all([
      hostCdp.dispatchKey('keyDown', 'KeyW', 'w', 87),
      guestCdp.dispatchKey('keyDown', 'KeyW', 'w', 87),
    ]);

    const raceProgress = await waitUntil('Both bikes advance s > 25m and both sides see opponent proxy > 25m', async () => {
      const [h, g] = await Promise.all([
        hostCdp.eval(`window.__gp500?.getOnlineState?.()`),
        guestCdp.eval(`window.__gp500?.getOnlineState?.()`),
      ]);
      const hLoc = h?.localRider?.s || 0;
      const hRem = h?.remoteRider?.s || 0;
      const gLoc = g?.localRider?.s || 0;
      const gRem = g?.remoteRider?.s || 0;
      return {
        ok: hLoc > 25 && hRem > 25 && gLoc > 25 && gRem > 25,
        hLoc,
        hRem,
        gLoc,
        gRem,
        hBuf: h?.bufferLength,
        gBuf: g?.bufferLength,
      };
    }, 25000, 200);

    const hostProxyDelta = Math.abs(raceProgress.gLoc - raceProgress.hRem);
    const guestProxyDelta = Math.abs(raceProgress.hLoc - raceProgress.gRem);
    console.log(
      `[webrtc] Synced racing verified! Host(local=${raceProgress.hLoc.toFixed(1)}m, proxy=${raceProgress.hRem.toFixed(1)}m, buf=${raceProgress.hBuf}) | Guest(local=${raceProgress.gLoc.toFixed(1)}m, proxy=${raceProgress.gRem.toFixed(1)}m, buf=${raceProgress.gBuf}) | proxyDelta=(${hostProxyDelta.toFixed(1)}m, ${guestProxyDelta.toFixed(1)}m)`
    );
    assert(hostProxyDelta < 25 && guestProxyDelta < 25, `Proxy divergence too large: hostDelta=${hostProxyDelta}, guestDelta=${guestProxyDelta}`);

    await Promise.all([hostCdp.waitFrames(4), guestCdp.waitFrames(4)]);
    const shotHost = path.join(OUTPUT_DIR, 'online_host.png');
    const shotGuest = path.join(OUTPUT_DIR, 'online_guest.png');
    const [bytesHost, bytesGuest] = await Promise.all([
      hostCdp.capturePng(shotHost),
      guestCdp.capturePng(shotGuest),
    ]);
    console.log(`[webrtc] Saved ${shotHost} (${bytesHost} bytes)`);
    console.log(`[webrtc] Saved ${shotGuest} (${bytesGuest} bytes)`);

    await Promise.all([
      hostCdp.dispatchKey('keyUp', 'KeyW', 'w', 87),
      guestCdp.dispatchKey('keyUp', 'KeyW', 'w', 87),
    ]);

    // -------------------------------------------------------------------------
    // 7. Test visibilitychange -> OPPONENT AWAY indicator on Host
    // -------------------------------------------------------------------------
    const createdTab = await guestBrowserCdp.send('Target.createTarget', { url: 'about:blank' });
    const dummyTargetId = createdTab?.targetId;
    assert(dummyTargetId, 'Failed to create background-switch dummy tab in Guest browser');
    await guestBrowserCdp.send('Target.activateTarget', { targetId: dummyTargetId });

    const guestHiddenState = await guestCdp.eval(`document.hidden`);
    let usedSyntheticVisibilityFallback = false;
    if (!guestHiddenState) {
      usedSyntheticVisibilityFallback = true;
      await guestCdp.eval(`(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      })()`);
    }

    const awaySeen = await waitUntil('Host displays OPPONENT AWAY banner when Guest tab hides', () =>
      hostCdp.eval(`(() => {
        const st = window.__gp500?.getOnlineState?.();
        const banner = document.getElementById('online-away-banner');
        const visible = Boolean(banner && !banner.classList.contains('hidden'));
        const text = (banner?.textContent || '').trim();
        return { ok: Boolean(st?.opponentAway && visible && /OPPONENT AWAY/i.test(text)), text, st };
      })()`),
      10000
    );
    console.log(`[webrtc] Visibility away verified (nativeTabSwitch=${!usedSyntheticVisibilityFallback}): "${awaySeen.text}"`);

    await guestBrowserCdp.send('Target.activateTarget', { targetId: guestBrowser.targetId });
    await guestBrowserCdp.send('Target.closeTarget', { targetId: dummyTargetId });
    if (usedSyntheticVisibilityFallback) {
      await guestCdp.eval(`(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
      })()`);
    }

    await waitUntil('Host clears OPPONENT AWAY banner when Guest returns', () =>
      hostCdp.eval(`(() => {
        const st = window.__gp500?.getOnlineState?.();
        const banner = document.getElementById('online-away-banner');
        return { ok: Boolean(!st?.opponentAway && banner && banner.classList.contains('hidden')) };
      })()`),
      10000
    );
    console.log('[webrtc] Visibility return verified (OPPONENT AWAY cleared)');

    // -------------------------------------------------------------------------
    // 8. Check 0 console / page / HTTP errors on BOTH Host and Guest
    // -------------------------------------------------------------------------
    const allErrors = [
      ...hostCdp.consoleErrors,
      ...hostCdp.pageErrors,
      ...guestCdp.consoleErrors,
      ...guestCdp.pageErrors,
    ];
    if (allErrors.length > 0) {
      throw new Error(`Browser console/page/HTTP errors detected (${allErrors.length}):\n  ${allErrors.join('\n  ')}`);
    }
    console.log('[webrtc] Host & Guest Browser Console/Page/HTTP Errors: 0 (CLEAN)');
  } catch (err) {
    if (hostCdp?.consoleErrors?.length) {
      console.error('[webrtc] Host console errors:', hostCdp.consoleErrors);
    }
    if (guestCdp?.consoleErrors?.length) {
      console.error('[webrtc] Guest console errors:', guestCdp.consoleErrors);
    }
    if (hostCdp?.consoleLogs?.length) {
      console.error('[webrtc] Host console logs:', hostCdp.consoleLogs.slice(-10));
    }
    if (guestCdp?.consoleLogs?.length) {
      console.error('[webrtc] Guest console logs:', guestCdp.consoleLogs.slice(-10));
    }
    throw err;
  } finally {
    hostCdp?.close();
    guestCdp?.close();
    guestBrowserCdp?.close();
    if (hostBrowser?.proc) {
      try {
        hostBrowser.proc.kill();
      } catch {
        // ignore
      }
    }
    if (guestBrowser?.proc) {
      try {
        guestBrowser.proc.kill();
      } catch {
        // ignore
      }
    }
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // ignore temp cleanup errors
    }
  }
}

main().catch((err) => {
  console.error('[webrtc] Verification failed:', err);
  process.exit(1);
});
