/**
 * test_suite.js - Comprehensive Automated Verification Test Suite
 * Bubble Shooter Arcade Game
 * 
 * Verifies:
 * 1. File existence & syntax
 * 2. DOM ID & HTML structure validation
 * 3. Hex grid geometry & coordinate conversions
 * 4. Hex neighbor mapping & Euclidean distance verification
 * 5. Match-3 BFS flood-fill algorithm
 * 6. Floating / orphan bubble BFS connectivity detection
 * 7. Ceiling drop penalty & danger line breach detection
 * 8. Trajectory raycasting & projectile snapping logic
 * 9. Audio API exports & headless runtime safety
 * 10. End-to-end simulated gameplay scenarios
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    if (err.stack) {
      const stackLines = err.stack.split('\n').slice(1, 4).join('\n');
      console.error(stackLines);
    }
  }
}

console.log('====================================================');
console.log('BUBBLE SHOOTER ARCADE - AUTOMATED VERIFICATION SUITE');
console.log('====================================================\n');

// -------------------------------------------------------------
// SUITE 1: FILE EXISTENCE & SYNTAX INTEGRITY
// -------------------------------------------------------------
console.log('--- SUITE 1: Files & Syntax Integrity ---');

const requiredFiles = ['index.html', 'style.css', 'audio.js', 'game.js'];

for (const file of requiredFiles) {
  runTest(`File '${file}' exists and is non-empty`, () => {
    const filePath = path.join(__dirname, file);
    assert.ok(fs.existsSync(filePath), `Missing required file: ${file}`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 100, `File ${file} is unexpectedly small (${stat.size} bytes)`);
  });
}

// -------------------------------------------------------------
// SUITE 2: DOM & HTML STRUCTURE VALIDATION
// -------------------------------------------------------------
console.log('\n--- SUITE 2: DOM Structure & Element IDs ---');

const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

runTest('index.html loads audio.js BEFORE game.js', () => {
  const audioScriptIdx = htmlContent.indexOf('src="audio.js"');
  const gameScriptIdx = htmlContent.indexOf('src="game.js"');
  assert.ok(audioScriptIdx !== -1, 'audio.js script tag missing in index.html');
  assert.ok(gameScriptIdx !== -1, 'game.js script tag missing in index.html');
  assert.ok(audioScriptIdx < gameScriptIdx, 'audio.js must be loaded before game.js');
});

runTest('index.html links style.css', () => {
  assert.ok(htmlContent.includes('href="style.css"'), 'style.css link tag missing in index.html');
});

const expectedIds = [
  'game-canvas',
  'next-bubble-canvas',
  'score',
  'high-score',
  'level',
  'miss-counter',
  'miss-indicators',
  'btn-pause',
  'btn-mute',
  'btn-restart',
  'start-modal',
  'btn-start',
  'pause-modal',
  'btn-resume',
  'btn-pause-restart',
  'game-over-modal',
  'final-score',
  'final-high-score',
  'btn-play-again',
  'victory-modal',
  'victory-score',
  'btn-next-level',
  'btn-victory-restart'
];

for (const id of expectedIds) {
  runTest(`DOM element ID '#${id}' exists in index.html`, () => {
    const regex = new RegExp(`id=["']${id}["']`);
    assert.ok(regex.test(htmlContent), `Element id="${id}" not found in index.html`);
  });
}

// -------------------------------------------------------------
// SUITE 3: MODULE IMPORTS & API EXPORTS
// -------------------------------------------------------------
console.log('\n--- SUITE 3: Module Exports & APIs ---');

const GameExport = require('./game.js');
const GameAudio = require('./audio.js');

const {
  HexGrid,
  Bubble,
  BUBBLE_PALETTE,
  BubbleShooterGame,
  GRID_COLS,
  BUBBLE_RADIUS,
  ROW_HEIGHT,
  MAX_ROWS,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  DANGER_Y
} = GameExport;

runTest('game.js exports all essential constants and classes', () => {
  assert.strictEqual(typeof HexGrid, 'function', 'HexGrid constructor missing');
  assert.strictEqual(typeof Bubble, 'function', 'Bubble constructor missing');
  assert.ok(Array.isArray(BUBBLE_PALETTE), 'BUBBLE_PALETTE must be an array');
  assert.strictEqual(BUBBLE_PALETTE.length, 6, 'BUBBLE_PALETTE must have 6 colors');
  assert.strictEqual(typeof BubbleShooterGame, 'function', 'BubbleShooterGame constructor missing');
  assert.strictEqual(GRID_COLS, 8, 'GRID_COLS must be 8');
  assert.strictEqual(BUBBLE_RADIUS, 30, 'BUBBLE_RADIUS must be 30');
  assert.strictEqual(CANVAS_WIDTH, 480, 'CANVAS_WIDTH must be 480');
  assert.strictEqual(CANVAS_HEIGHT, 640, 'CANVAS_HEIGHT must be 640');
  assert.strictEqual(DANGER_Y, 540, 'DANGER_Y must be 540');
});

runTest('audio.js exports all window.GameAudio API methods', () => {
  const expectedMethods = [
    'init',
    'playShoot',
    'playBounce',
    'playPop',
    'playDrop',
    'playCeilingDrop',
    'playGameOver',
    'playVictory',
    'toggleMute',
    'isMuted',
    'toggleMusic',
    'isMusicPlaying',
    'setMasterVolume'
  ];

  for (const method of expectedMethods) {
    assert.strictEqual(
      typeof GameAudio[method],
      'function',
      `GameAudio.${method} must be a function`
    );
  }
});

runTest('GameAudio methods run safely without throwing in headless environment', () => {
  assert.doesNotThrow(() => GameAudio.init());
  assert.doesNotThrow(() => GameAudio.playShoot());
  assert.doesNotThrow(() => GameAudio.playBounce());
  assert.doesNotThrow(() => GameAudio.playPop(1));
  assert.doesNotThrow(() => GameAudio.playPop(3));
  assert.doesNotThrow(() => GameAudio.playDrop(2));
  assert.doesNotThrow(() => GameAudio.playCeilingDrop());
  assert.doesNotThrow(() => GameAudio.playGameOver());
  assert.doesNotThrow(() => GameAudio.playVictory());
  assert.doesNotThrow(() => {
    const muted = GameAudio.toggleMute();
    assert.strictEqual(typeof muted, 'boolean');
    assert.strictEqual(GameAudio.isMuted(), muted);
    GameAudio.toggleMute(); // toggle back
  });
  assert.doesNotThrow(() => {
    const musicPlaying = GameAudio.toggleMusic();
    assert.strictEqual(typeof musicPlaying, 'boolean');
    assert.strictEqual(GameAudio.isMusicPlaying(), musicPlaying);
    GameAudio.toggleMusic(); // stop music
  });
  assert.doesNotThrow(() => GameAudio.setMasterVolume(0.5));
});

// -------------------------------------------------------------
// SUITE 4: HEX GRID MATH & COORDINATE CONVERSION
// -------------------------------------------------------------
console.log('\n--- SUITE 4: Hex Grid Math & Geometry ---');

runTest('HexGrid row column counts alternate correctly (8 and 7)', () => {
  const grid = new HexGrid(GRID_COLS, BUBBLE_RADIUS, MAX_ROWS, CANVAS_WIDTH, CANVAS_HEIGHT);
  for (let r = 0; r < MAX_ROWS; r++) {
    const cols = grid.getColsForRow(r);
    if (r % 2 === 0) {
      assert.strictEqual(cols, 8, `Even row ${r} must have 8 columns`);
    } else {
      assert.strictEqual(cols, 7, `Odd row ${r} must have 7 columns`);
    }
  }
});

runTest('gridToPixel positions even and odd rows symmetrically across canvas width', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  
  // Row 0 (even): 8 bubbles of radius 30 (diameter 60).
  // First bubble center = 30, last bubble center = 7 * 60 + 30 = 450.
  // Right edge of last bubble = 450 + 30 = 480 (exact fit!).
  const r0_c0 = grid.gridToPixel(0, 0);
  const r0_c7 = grid.gridToPixel(0, 7);
  assert.strictEqual(r0_c0.x, 30, 'Row 0 Col 0 X should be 30');
  assert.strictEqual(r0_c7.x, 450, 'Row 0 Col 7 X should be 450');
  assert.strictEqual(r0_c7.x + 30, 480, 'Row 0 rightmost edge must touch canvas edge 480');

  // Row 1 (odd): 7 bubbles, staggered by half a bubble (30px offset).
  // First bubble center = 60, last bubble center = 6 * 60 + 60 = 420.
  // Left margin = 60 - 30 = 30. Right margin = 480 - (420 + 30) = 30. Perfectly centered!
  const r1_c0 = grid.gridToPixel(1, 0);
  const r1_c6 = grid.gridToPixel(1, 6);
  assert.strictEqual(r1_c0.x, 60, 'Row 1 Col 0 X should be 60');
  assert.strictEqual(r1_c6.x, 420, 'Row 1 Col 6 X should be 420');
  assert.strictEqual(r1_c0.x - 30, 480 - (r1_c6.x + 30), 'Odd row must have equal left and right margins');
});

runTest('Euclidean distance between any adjacent hex neighbors is exactly 2 * BUBBLE_RADIUS (60.0px)', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const targetDist = 2 * 30; // 60px

  // Test across interior cells of both even and odd rows
  const testCells = [
    { r: 2, c: 3 }, // even row interior
    { r: 3, c: 3 }, // odd row interior
    { r: 4, c: 2 }, // even row interior
    { r: 5, c: 4 }  // odd row interior
  ];

  for (const cell of testCells) {
    const center = grid.gridToPixel(cell.r, cell.c);
    const neighbors = grid.getNeighbors(cell.r, cell.c);
    assert.strictEqual(neighbors.length, 6, `Interior cell (${cell.r}, ${cell.c}) must have 6 neighbors`);

    for (const n of neighbors) {
      const nCenter = grid.gridToPixel(n.r, n.c);
      const dx = center.x - nCenter.x;
      const dy = center.y - nCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      assert.ok(
        Math.abs(dist - targetDist) < 0.001,
        `Distance between (${cell.r},${cell.c}) and neighbor (${n.r},${n.c}) is ${dist}, expected ${targetDist}`
      );
    }
  }
});

runTest('pixelToGrid accurately maps gridToPixel center back to original (r, c)', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);

  for (let r = 0; r < 8; r++) {
    const cols = grid.getColsForRow(r);
    for (let c = 0; c < cols; c++) {
      const pixel = grid.gridToPixel(r, c);
      const reverse = grid.pixelToGrid(pixel.x, pixel.y);
      assert.strictEqual(reverse.r, r, `pixelToGrid row mismatch for (${r}, ${c}): got ${reverse.r}`);
      assert.strictEqual(reverse.c, c, `pixelToGrid col mismatch for (${r}, ${c}): got ${reverse.c}`);
      assert.ok(reverse.dist < 0.001, `Distance to center should be 0, got ${reverse.dist}`);
    }
  }
});

// -------------------------------------------------------------
// SUITE 5: MATCH-3 BFS FLOOD FILL ALGORITHM
// -------------------------------------------------------------
console.log('\n--- SUITE 5: Match-3 Flood Fill BFS ---');

runTest('Single isolated bubble returns match count 1 (no pop)', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const red = BUBBLE_PALETTE[0];
  grid.setBubble(2, 2, new Bubble(red));

  const matches = grid.findMatches(2, 2);
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].r, 2);
  assert.strictEqual(matches[0].c, 2);
});

runTest('Two adjacent identical bubbles return match count 2 (< 3, no pop)', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const red = BUBBLE_PALETTE[0];
  grid.setBubble(2, 2, new Bubble(red));
  grid.setBubble(2, 3, new Bubble(red)); // horizontal neighbor

  const matches = grid.findMatches(2, 2);
  assert.strictEqual(matches.length, 2);
});

runTest('Cluster of 3 connected identical bubbles returns match count 3 (qualifies for pop)', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const blue = BUBBLE_PALETTE[1];
  grid.setBubble(2, 2, new Bubble(blue));
  grid.setBubble(2, 3, new Bubble(blue));
  // In even row (2), top-right neighbor of (2,2) is (1, 2)
  grid.setBubble(1, 2, new Bubble(blue));

  const matches = grid.findMatches(2, 2);
  assert.strictEqual(matches.length, 3);
});

runTest('Cluster of 6 same-color bubbles with complex branching and loops is fully detected', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const green = BUBBLE_PALETTE[2];
  const yellow = BUBBLE_PALETTE[3];

  // Green cluster:
  // (0,0), (0,1), (1,0), (1,1), (2,0), (2,1)
  const greenCoords = [
    { r: 0, c: 0 },
    { r: 0, c: 1 },
    { r: 1, c: 0 },
    { r: 1, c: 1 },
    { r: 2, c: 0 },
    { r: 2, c: 1 }
  ];

  for (const pt of greenCoords) {
    grid.setBubble(pt.r, pt.c, new Bubble(green));
  }

  // Neighboring yellow bubbles that should NOT be included
  grid.setBubble(0, 2, new Bubble(yellow));
  grid.setBubble(1, 2, new Bubble(yellow));
  grid.setBubble(2, 2, new Bubble(yellow));

  const matches = grid.findMatches(0, 0);
  assert.strictEqual(matches.length, 6, `Expected 6 green matches, found ${matches.length}`);

  // All matched coords must be in greenCoords
  for (const m of matches) {
    const found = greenCoords.some(pt => pt.r === m.r && pt.c === m.c);
    assert.ok(found, `Matched cell (${m.r}, ${m.c}) was not in original green cluster`);
  }
});

// -------------------------------------------------------------
// SUITE 6: FLOATING / ORPHAN BUBBLE BFS DETECTION
// -------------------------------------------------------------
console.log('\n--- SUITE 6: Floating Bubble BFS Detection ---');

runTest('All bubbles connected to ceiling (row 0) return 0 floating orphans', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const red = BUBBLE_PALETTE[0];

  // Chain from row 0 to row 3:
  grid.setBubble(0, 2, new Bubble(red)); // row 0 (ceiling)
  grid.setBubble(1, 2, new Bubble(red)); // neighbor in row 1
  grid.setBubble(2, 2, new Bubble(red)); // neighbor in row 2
  grid.setBubble(3, 2, new Bubble(red)); // neighbor in row 3

  const orphans = grid.findFloatingBubbles();
  assert.strictEqual(orphans.length, 0, 'No bubbles should be orphaned');
});

runTest('Bubbles disconnected from row 0 are accurately detected as orphans', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const red = BUBBLE_PALETTE[0];
  const blue = BUBBLE_PALETTE[1];

  // Anchored cluster at row 0:
  grid.setBubble(0, 0, new Bubble(red));
  grid.setBubble(0, 1, new Bubble(red));

  // Disconnected cluster floating at rows 4 and 5:
  grid.setBubble(4, 3, new Bubble(blue));
  grid.setBubble(4, 4, new Bubble(blue));
  grid.setBubble(5, 3, new Bubble(blue));

  const orphans = grid.findFloatingBubbles();
  assert.strictEqual(orphans.length, 3, `Expected 3 orphans, found ${orphans.length}`);

  const orphanKeys = orphans.map(o => `${o.r},${o.c}`).sort();
  assert.deepStrictEqual(orphanKeys, ['4,3', '4,4', '5,3']);
});

runTest('Removing an anchor bubble cascades orphan status to all dependent bubbles below it', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const purple = BUBBLE_PALETTE[4];

  // Anchor at ceiling
  grid.setBubble(0, 4, new Bubble(purple));
  // Hanging chain:
  grid.setBubble(1, 4, new Bubble(purple));
  grid.setBubble(2, 4, new Bubble(purple));
  grid.setBubble(3, 4, new Bubble(purple));

  assert.strictEqual(grid.findFloatingBubbles().length, 0, 'Initially all connected');

  // Pop / remove anchor at row 0
  grid.removeBubble(0, 4);

  const orphans = grid.findFloatingBubbles();
  assert.strictEqual(orphans.length, 3, 'All 3 hanging bubbles must now be orphans');
});

runTest('Completely empty row 0 causes all lower bubbles to become orphans', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const orange = BUBBLE_PALETTE[5];

  grid.setBubble(2, 2, new Bubble(orange));
  grid.setBubble(2, 3, new Bubble(orange));
  grid.setBubble(3, 2, new Bubble(orange));

  const orphans = grid.findFloatingBubbles();
  assert.strictEqual(orphans.length, 3, 'All lower bubbles should be orphaned when row 0 is empty');
});

// -------------------------------------------------------------
// SUITE 7: CEILING DROP PENALTY & DANGER LINE BREACH
// -------------------------------------------------------------
console.log('\n--- SUITE 7: Ceiling Drop & Danger Line ---');

runTest('dropCeiling shifts all existing bubbles down by 1 row and toggles parity', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const red = BUBBLE_PALETTE[0];
  grid.setBubble(0, 3, new Bubble(red));

  assert.strictEqual(grid.rowOffsetParity, 0);

  grid.dropCeiling(BUBBLE_PALETTE.slice(0, 2));

  // Parity toggled
  assert.strictEqual(grid.rowOffsetParity, 1);

  // New row inserted at row 0
  const cols0 = grid.getColsForRow(0);
  for (let c = 0; c < cols0; c++) {
    assert.ok(grid.getBubble(0, c) !== null, `Cell (0, ${c}) must be populated in dropped ceiling`);
  }

  // Old row 0 bubble is now at row 1 col 3
  const shiftedBubble = grid.getBubble(1, 3);
  assert.ok(shiftedBubble !== null, 'Shifted bubble should be at row 1');
  assert.strictEqual(shiftedBubble.colorId, red.id, 'Shifted bubble must retain its original color');
});

runTest('hasBreachedDangerLine triggers true when bubble bottom crosses DANGER_Y (540px)', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const red = BUBBLE_PALETTE[0];

  // At row 0, bottom edge is radius * 2 = 60px < 540
  grid.setBubble(0, 0, new Bubble(red));
  assert.strictEqual(grid.hasBreachedDangerLine(540), false);

  // Find row that crosses 540px:
  // y = r * rowHeight + radius. Bottom edge = y + radius.
  // When y + 30 >= 540 => y >= 510 => r * 51.96 + 30 >= 510 => r >= 480 / 51.96 = 9.23 => row 10
  const r10Pos = grid.gridToPixel(10, 0);
  assert.ok(r10Pos.y + 30 >= 540, `Row 10 bottom should exceed 540: ${r10Pos.y + 30}`);

  grid.setBubble(10, 0, new Bubble(red));
  assert.strictEqual(grid.hasBreachedDangerLine(540), true);
});

// -------------------------------------------------------------
// SUITE 8: PROJECTILE SNAPPING & COLLISION LOGIC
// -------------------------------------------------------------
console.log('\n--- SUITE 8: Projectile Snapping Logic ---');

runTest('Projectile near ceiling snaps to valid row 0 slot', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  
  // Straight up shot at x = 240, near ceiling (y = 25)
  // Closest row 0 slot: x=240 is between c=3 (210) and c=4 (270)
  const snap = grid.snapProjectile(240, 25, null);
  assert.strictEqual(snap.r, 0, 'Ceiling shot must snap to row 0');
  assert.ok(snap.c >= 0 && snap.c < 8, `Column must be valid: ${snap.c}`);
});

runTest('Projectile hitting an existing bubble snaps to an adjacent empty neighbor', () => {
  const grid = new HexGrid(8, 30, 14, 480, 640);
  const blue = BUBBLE_PALETTE[1];
  
  // Bubble at row 0, col 3 (center x = 3 * 60 + 30 = 210, y = 30)
  grid.setBubble(0, 3, new Bubble(blue));

  // Projectile hitting near bottom of bubble (0, 3) at x = 210, y = 80
  const snap = grid.snapProjectile(210, 80, { r: 0, c: 3, x: 210, y: 30 });

  // Snap position must be empty and must be an immediate neighbor of (0, 3)
  assert.ok(grid.isEmpty(snap.r, snap.c), 'Snap position must be empty');
  const neighbors = grid.getNeighbors(0, 3);
  const isNeighbor = neighbors.some(n => n.r === snap.r && n.c === snap.c);
  assert.ok(isNeighbor, `Snapped cell (${snap.r}, ${snap.c}) must be neighbor of (0, 3)`);
});

// -------------------------------------------------------------
// SUITE 9: GAME ENGINE INITIALIZATION & STATE MACHINE
// -------------------------------------------------------------
console.log('\n--- SUITE 9: Game Engine State Machine ---');

runTest('BubbleShooterGame instantiates with clean initial state', () => {
  const game = new BubbleShooterGame();
  assert.strictEqual(game.state, 'start', 'Initial state should be "start"');
  assert.strictEqual(game.score, 0, 'Initial score should be 0');
  assert.strictEqual(game.level, 1, 'Initial level should be 1');
  assert.strictEqual(game.combo, 0, 'Initial combo should be 0');
  assert.strictEqual(game.isShooting, false, 'Should not be shooting');
  assert.strictEqual(game.projectile, null, 'Projectile should be null');
});

runTest('startLevel(1) generates valid initial bubbles, loaded bubble, and next bubble', () => {
  const game = new BubbleShooterGame();
  game.startLevel(1, false);

  assert.ok(game.currentBubble !== null, 'currentBubble must be loaded');
  assert.ok(game.nextBubble !== null, 'nextBubble must be ready');
  assert.ok(game.currentBubble.color, 'currentBubble must have valid color');
  assert.ok(game.nextBubble.color, 'nextBubble must have valid color');

  const totalBubbles = game.grid.getTotalBubbles();
  assert.ok(totalBubbles > 15, `Initial board should have populated bubbles, found ${totalBubbles}`);
});

runTest('swapBubbles() correctly exchanges currentBubble and nextBubble', () => {
  const game = new BubbleShooterGame();
  game.startLevel(1, true);

  const originalCurrent = game.currentBubble;
  const originalNext = game.nextBubble;

  game.swapBubbles();

  assert.strictEqual(game.currentBubble, originalNext, 'currentBubble should now be originalNext');
  assert.strictEqual(game.nextBubble, originalCurrent, 'nextBubble should now be originalCurrent');
});

runTest('resolveProjectileImpact() triggers combo pop and score accumulation on match >= 3', () => {
  const game = new BubbleShooterGame();
  game.startLevel(1, true);

  // Setup controlled board: 2 red bubbles at (0, 0) and (0, 1)
  game.grid.initGrid();
  const red = BUBBLE_PALETTE[0];
  game.grid.setBubble(0, 0, new Bubble(red));
  game.grid.setBubble(0, 1, new Bubble(red));

  // Fire a 3rd red bubble that snaps into (1, 0) (neighbor to both)
  game.isShooting = true;
  game.projectile = {
    x: 60,
    y: 80,
    vx: 0,
    vy: -1000,
    color: red,
    colorId: red.id
  };

  const initialScore = game.score;
  const hitBubble = { r: 0, c: 0, x: 30, y: 30 };
  game.resolveProjectileImpact(60, 80, hitBubble);

  // Should pop all 3 red bubbles
  assert.strictEqual(game.combo, 1, 'Combo should be 1');
  assert.ok(game.score > initialScore, `Score must increase: ${game.score} > ${initialScore}`);
  assert.strictEqual(game.grid.getTotalBubbles(), 0, 'Board should be cleared');
  assert.strictEqual(game.state, 'win', 'Clearing board should transition to win state');
});

runTest('resolveProjectileImpact() decrements missesRemaining on non-match and drops ceiling when 0', () => {
  const game = new BubbleShooterGame();
  game.startLevel(1, true);
  game.missesRemaining = 1; // Only 1 miss left

  const red = BUBBLE_PALETTE[0];
  const blue = BUBBLE_PALETTE[1];
  game.grid.initGrid();
  game.grid.setBubble(0, 0, new Bubble(red));

  // Shoot blue bubble (no match)
  game.isShooting = true;
  game.projectile = {
    x: 90,
    y: 80,
    vx: 0,
    vy: -1000,
    color: blue,
    colorId: blue.id
  };

  const initialParity = game.grid.rowOffsetParity;
  game.resolveProjectileImpact(90, 80, { r: 0, c: 0, x: 30, y: 30 });

  // Missed shot should trigger ceiling drop and reset miss counter
  assert.strictEqual(game.combo, 0, 'Combo should reset to 0');
  assert.strictEqual(game.missesRemaining, game.maxMisses, 'Miss counter should reset to maxMisses');
  assert.strictEqual(game.grid.rowOffsetParity, (initialParity + 1) % 2, 'Row parity should toggle on ceiling drop');
});

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log('\n====================================================');
console.log(`TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
if (passedTests === totalTests) {
  console.log('ALL VERIFICATIONS PASSED SUCCESSFULLY!');
} else {
  console.error(`FAILED: ${totalTests - passedTests} test(s) failed.`);
  process.exit(1);
}
console.log('====================================================');
