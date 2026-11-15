/**
 * test_raycast.js - Trajectory Raycasting & Physics Verification
 */

'use strict';

const assert = require('assert');
const { HexGrid, Bubble, BUBBLE_PALETTE, BubbleShooterGame } = require('./game.js');

console.log('--- Testing Raycasting Trajectory & Snapping ---');

const grid = new HexGrid(8, 30, 14, 480, 640);

// Populate a ceiling row
for (let c = 0; c < 8; c++) {
  grid.setBubble(0, c, new Bubble(BUBBLE_PALETTE[c % 6]));
}

const game = new BubbleShooterGame();
game.grid = grid;

// Test straight shot up
game.cannonAngle = -Math.PI / 2; // -90 deg
let trajStraight = game.grid ? null : null;

// Test shooting towards left wall (-135 deg / -3*PI/4)
// Should bounce off left wall (x=30) and proceed towards top right
const angles = [
  -Math.PI / 2,             // Straight up
  -Math.PI / 4,             // Up-right (45 deg)
  -3 * Math.PI / 4,         // Up-left (135 deg)
  -Math.PI + 0.2,           // Very shallow left
  -0.2                      // Very shallow right
];

for (const angle of angles) {
  game.cannonAngle = angle;
  // Test that shoot() sets correct velocities
  game.isShooting = false;
  game.state = 'playing';
  game.currentBubble = new Bubble(BUBBLE_PALETTE[0]);
  game.shoot();

  assert.ok(game.isShooting, `Should be shooting at angle ${angle}`);
  assert.ok(game.projectile !== null, 'Projectile must exist');
  assert.strictEqual(game.projectile.x, 240, 'Projectile start X must be 240');
  assert.strictEqual(game.projectile.y, 595, 'Projectile start Y must be 595');
  assert.ok(game.projectile.vy < 0, `Projectile vy must be negative (upward): ${game.projectile.vy}`);

  // Simulate projectile movement until impact
  let steps = 0;
  while (game.isShooting && steps < 500) {
    game.updateProjectile(0.016);
    steps++;
  }

  assert.ok(!game.isShooting, `Projectile should have resolved impact within 500 steps for angle ${angle}`);
  console.log(`  [PASS] Raycast & Projectile resolved successfully for angle ${(angle * 180 / Math.PI).toFixed(1)}° in ${steps} steps`);
}

console.log('ALL RAYCAST & PROJECTILE TESTS PASSED!\n');
