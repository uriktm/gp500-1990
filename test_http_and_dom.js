/**
 * test_http_and_dom.js - Static Server & Headless DOM Integration Verification
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Static Server & HTTP Verification
const PORT = 8089;
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript'
};

const server = http.createServer((req, res) => {
  const parsedUrl = req.url.split('?')[0];
  const relativePath = (parsedUrl === '/' || parsedUrl === '') ? 'index.html' : parsedUrl.replace(/^\/+/, '');
  const filePath = path.join(__dirname, relativePath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, async () => {
  console.log(`[HTTP Test] Static server listening on port ${PORT}`);

  try {
    const filesToTest = [
      { url: '/', mime: 'text/html' },
      { url: '/index.html', mime: 'text/html' },
      { url: '/style.css', mime: 'text/css' },
      { url: '/audio.js', mime: 'application/javascript' },
      { url: '/game.js', mime: 'application/javascript' }
    ];

    for (const item of filesToTest) {
      await new Promise((resolve, reject) => {
        http.get(`http://localhost:${PORT}${item.url}`, (res) => {
          assert.strictEqual(res.statusCode, 200, `Expected 200 for ${item.url}`);
          assert.ok(
            res.headers['content-type'].includes(item.mime),
            `Expected mime ${item.mime} for ${item.url}, got ${res.headers['content-type']}`
          );

          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            assert.ok(data.length > 50, `Response for ${item.url} is too short`);
            console.log(`  [HTTP PASS] ${item.url} -> 200 OK (${data.length} bytes, ${res.headers['content-type']})`);
            resolve();
          });
        }).on('error', reject);
      });
    }

    // 2. Headless DOM Mock Integration Test
    console.log('\n[DOM Mock Test] Verifying BubbleShooterGame in simulated DOM environment...');

    function createMockElement(id, tag = 'div') {
      const classList = new Set();
      const listeners = {};
      return {
        id,
        tagName: tag.toUpperCase(),
        classList: {
          add: (cls) => classList.add(cls),
          remove: (cls) => classList.delete(cls),
          toggle: (cls, force) => {
            if (force === undefined) {
              if (classList.has(cls)) classList.delete(cls);
              else classList.add(cls);
            } else if (force) {
              classList.add(cls);
            } else {
              classList.delete(cls);
            }
          },
          contains: (cls) => classList.has(cls)
        },
        style: {},
        textContent: '',
        addEventListener: (event, fn) => {
          if (!listeners[event]) listeners[event] = [];
          listeners[event].push(fn);
        },
        removeEventListener: (event, fn) => {
          if (listeners[event]) {
            listeners[event] = listeners[event].filter(l => l !== fn);
          }
        },
        dispatchEvent: (event, data) => {
          if (listeners[event]) {
            for (const fn of listeners[event]) fn(data || {});
          }
        },
        querySelectorAll: (selector) => {
          return [createMockElement('dot-1'), createMockElement('dot-2'), createMockElement('dot-3')];
        },
        getContext: () => ({
          save: () => {},
          restore: () => {},
          translate: () => {},
          rotate: () => {},
          scale: () => {},
          beginPath: () => {},
          closePath: () => {},
          arc: () => {},
          ellipse: () => {},
          rect: () => {},
          roundRect: () => {},
          fill: () => {},
          stroke: () => {},
          fillRect: () => {},
          strokeRect: () => {},
          clearRect: () => {},
          moveTo: () => {},
          lineTo: () => {},
          fillText: () => {},
          measureText: () => ({ width: 50 }),
          createRadialGradient: () => ({ addColorStop: () => {} }),
          createLinearGradient: () => ({ addColorStop: () => {} }),
          setLineDash: () => {}
        }),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 640 })
      };
    }

    const domRegistry = {};
    const ids = [
      'game-canvas', 'next-bubble-canvas', 'score', 'high-score', 'level',
      'miss-counter', 'miss-indicators', 'btn-pause', 'btn-mute', 'btn-restart',
      'start-modal', 'btn-start', 'pause-modal', 'btn-resume', 'btn-pause-restart',
      'game-over-modal', 'final-score', 'final-high-score', 'btn-play-again',
      'victory-modal', 'victory-score', 'btn-next-level', 'btn-victory-restart'
    ];

    for (const id of ids) {
      domRegistry[id] = createMockElement(id, id.includes('canvas') ? 'canvas' : (id.includes('btn') ? 'button' : 'div'));
    }

    // Set up mock window and document
    global.window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      requestAnimationFrame: (cb) => setTimeout(cb, 16),
      cancelAnimationFrame: (id) => clearTimeout(id)
    };
    global.document = {
      getElementById: (id) => domRegistry[id] || null,
      addEventListener: () => {},
      readyState: 'complete'
    };
    global.localStorage = {
      _store: {},
      getItem: function (k) { return this._store[k] || null; },
      setItem: function (k, v) { this._store[k] = String(v); }
    };

    const GameExport = require('./game.js');
    const game = new GameExport.BubbleShooterGame();

    // Test game.init()
    assert.doesNotThrow(() => game.init(), 'game.init() threw an error!');
    console.log('  [DOM PASS] game.init() executed cleanly');

    // Simulate clicking "START GAME" button
    domRegistry['btn-start'].dispatchEvent('click');
    assert.strictEqual(game.state, 'playing', 'Game state should be "playing" after start button click');
    console.log('  [DOM PASS] Start button event triggered gameplay');

    // Simulate clicking "PAUSE" button
    domRegistry['btn-pause'].dispatchEvent('click');
    assert.strictEqual(game.state, 'paused', 'Game state should be "paused" after pause click');
    assert.ok(domRegistry['pause-modal'].classList.contains('active'), 'Pause modal must be active');
    console.log('  [DOM PASS] Pause button toggled pause modal');

    // Simulate clicking "RESUME" button
    domRegistry['btn-resume'].dispatchEvent('click');
    assert.strictEqual(game.state, 'playing', 'Game state should be "playing" after resume click');
    assert.ok(!domRegistry['pause-modal'].classList.contains('active'), 'Pause modal must be closed');
    console.log('  [DOM PASS] Resume button resumed gameplay');

    // Simulate clicking "MUTE" button
    domRegistry['btn-mute'].dispatchEvent('click');
    console.log('  [DOM PASS] Mute button toggled audio safely');

    // Simulate running 10 frames of game loop
    for (let f = 0; f < 10; f++) {
      assert.doesNotThrow(() => {
        game.update(f * 16.6);
        game.render();
      }, `Frame ${f} update/render threw an error`);
    }
    console.log('  [DOM PASS] 10 game loop update & render frames executed smoothly');

    console.log('\nALL HTTP & DOM INTEGRATION TESTS PASSED!');
    server.close();
    process.exit(0);

  } catch (err) {
    console.error('[TEST ERROR]', err);
    server.close();
    process.exit(1);
  }
});
