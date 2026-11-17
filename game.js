/**
 * game.js - Bubble Shooter Arcade Game Engine
 * HTML5 Canvas Hexagonal Grid Bubble Shooter Engine
 * 
 * Features:
 * 1. Hexagonal grid math: offset row coordinate mapping (staggered even/odd rows), pixelToGrid & gridToPixel.
 * 2. Aiming and projectile physics: smooth mouse/touch aiming, raycasting trajectory line with wall reflections.
 * 3. Hex grid snapping: collision detection with existing bubbles & ceiling, snapping to nearest valid empty slot.
 * 4. Match-3 logic: Breadth-First Search (BFS) / flood-fill for connected bubbles of identical color (pop >= 3).
 * 5. Floating/orphan bubble detection: BFS from ceiling bubbles (row 0), dropping disconnected bubbles.
 * 6. Ceiling drop / penalty system: tracks missed shots, lowers ceiling / adds row after N misses.
 * 7. Particle system & visual juice: glossy 3D bubbles, pop fragments, bouncing falling bubbles, floating score popups, screen shake.
 * 8. State machine & controls: start, playing, paused, game-over, win states. Web Audio hooks to window.GameAudio.
 * 9. Next bubble queue, dynamic color selection from board, score and high score persistence in localStorage.
 */

(function (root, factory) {
  'use strict';
  var GameExport = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameExport;
  }

  if (typeof root !== 'undefined') {
    root.HexGrid = GameExport.HexGrid;
    root.Bubble = GameExport.Bubble;
    root.BUBBLE_PALETTE = GameExport.BUBBLE_PALETTE;
    root.BubbleShooterGame = GameExport.BubbleShooterGame;
  }

  // Auto-initialize in browser when DOM is ready
  if (typeof document !== 'undefined') {
    var onReady = function () {
      if (typeof root !== 'undefined' && !root.BubbleGame && root.BubbleShooterGame) {
        root.BubbleGame = new root.BubbleShooterGame();
        root.BubbleGame.init();
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this), function () {
  'use strict';

  // ==========================================================================
  // 1. CONSTANTS & BUBBLE PALETTE
  // ==========================================================================

  var CANVAS_WIDTH = 480;
  var CANVAS_HEIGHT = 640;
  var GRID_COLS = 8;
  var BUBBLE_RADIUS = 30; // 480 / (8 * 2) = 30px
  var ROW_HEIGHT = BUBBLE_RADIUS * Math.sqrt(3); // ~51.9615px
  var MAX_ROWS = 14;
  var DANGER_Y = 540; // Danger threshold near bottom
  var SHOOTER_X = CANVAS_WIDTH / 2; // 240
  var SHOOTER_Y = 595;
  var PROJECTILE_SPEED = 1450; // pixels per second
  var HIGH_SCORE_KEY = 'bubble_shooter_high_score';

  // Vibrant arcade neon color palette
  var BUBBLE_PALETTE = [
    {
      id: 'red',
      name: 'Ruby Red',
      hex: '#ff2a6d',
      light: '#ff7da7',
      dark: '#b8003f',
      glow: 'rgba(255, 42, 109, 0.65)'
    },
    {
      id: 'blue',
      name: 'Sapphire Blue',
      hex: '#00f0ff',
      light: '#7df7ff',
      dark: '#009bb3',
      glow: 'rgba(0, 240, 255, 0.65)'
    },
    {
      id: 'green',
      name: 'Emerald Green',
      hex: '#05ffa1',
      light: '#85ffd0',
      dark: '#00b368',
      glow: 'rgba(5, 255, 161, 0.65)'
    },
    {
      id: 'yellow',
      name: 'Amber Gold',
      hex: '#ffe600',
      light: '#fff27d',
      dark: '#b3a100',
      glow: 'rgba(255, 230, 0, 0.65)'
    },
    {
      id: 'purple',
      name: 'Amethyst Purple',
      hex: '#b026ff',
      light: '#d78aff',
      dark: '#7300b3',
      glow: 'rgba(176, 38, 255, 0.65)'
    },
    {
      id: 'orange',
      name: 'Solar Orange',
      hex: '#ff7700',
      light: '#ffb370',
      dark: '#b35300',
      glow: 'rgba(255, 119, 0, 0.65)'
    }
  ];

  // Helper to safely invoke GameAudio functions
  function safeAudio(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      if (typeof window !== 'undefined' && window.GameAudio && typeof window.GameAudio[method] === 'function') {
        return window.GameAudio[method].apply(window.GameAudio, args);
      }
    } catch (e) {
      // Audio failures must not crash the game loop
    }
    return null;
  }

  // ==========================================================================
  // 2. BUBBLE CLASS
  // ==========================================================================

  function Bubble(color) {
    this.color = color;
    this.colorId = color.id;
    this.scale = 1.0;
    this.alpha = 1.0;
    this.animTimer = 0;
  }

  // ==========================================================================
  // 3. HEXAGONAL GRID SYSTEM
  // ==========================================================================

  function HexGrid(cols, radius, maxRows, width, height) {
    this.cols = cols || GRID_COLS;
    this.radius = radius || BUBBLE_RADIUS;
    this.maxRows = maxRows || MAX_ROWS;
    this.width = width || CANVAS_WIDTH;
    this.height = height || CANVAS_HEIGHT;
    this.rowHeight = this.radius * Math.sqrt(3);

    this.ceilingOffset = 0;
    this.rowOffsetParity = 0; // 0: even rows are un-offset, 1: odd rows are un-offset

    this.grid = [];
    this.initGrid();
  }

  HexGrid.prototype.initGrid = function () {
    this.grid = [];
    for (var r = 0; r < this.maxRows; r++) {
      var rowCols = this.getColsForRow(r);
      var row = [];
      for (var c = 0; c < rowCols; c++) {
        row.push(null);
      }
      this.grid.push(row);
    }
  };

  HexGrid.prototype.isOffsetRow = function (r) {
    return ((r + this.rowOffsetParity) % 2 !== 0);
  };

  HexGrid.prototype.getColsForRow = function (r) {
    return this.isOffsetRow(r) ? (this.cols - 1) : this.cols;
  };

  /**
   * Converts grid (row, col) to canvas pixel center (x, y)
   */
  HexGrid.prototype.gridToPixel = function (r, c) {
    var isOffset = this.isOffsetRow(r);
    var x = isOffset
      ? (c * 2 * this.radius + 2 * this.radius)
      : (c * 2 * this.radius + this.radius);
    var y = this.ceilingOffset + r * this.rowHeight + this.radius;
    return { x: x, y: y };
  };

  /**
   * Converts canvas pixel coordinates (x, y) to the closest valid grid slot (r, c)
   */
  HexGrid.prototype.pixelToGrid = function (x, y) {
    var approxR = Math.round((y - this.ceilingOffset - this.radius) / this.rowHeight);
    if (approxR < 0) approxR = 0;
    if (approxR >= this.maxRows) approxR = this.maxRows - 1;

    var bestR = approxR;
    var bestC = 0;
    var bestDistSq = Infinity;

    var minR = Math.max(0, approxR - 2);
    var maxR = Math.min(this.maxRows - 1, approxR + 2);

    for (var r = minR; r <= maxR; r++) {
      var numCols = this.getColsForRow(r);
      for (var c = 0; c < numCols; c++) {
        var pos = this.gridToPixel(r, c);
        var dx = x - pos.x;
        var dy = y - pos.y;
        var distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestR = r;
          bestC = c;
        }
      }
    }

    return {
      r: bestR,
      c: bestC,
      dist: Math.sqrt(bestDistSq)
    };
  };

  /**
   * Returns valid adjacent hex neighbors for cell (r, c)
   */
  HexGrid.prototype.getNeighbors = function (r, c) {
    var neighbors = [];
    var isOffset = this.isOffsetRow(r);

    var offsets;
    if (!isOffset) {
      // Even / un-offset row
      offsets = [
        { dr: 0, dc: -1 }, // Left
        { dr: 0, dc: 1 },  // Right
        { dr: -1, dc: -1 },// Top-Left
        { dr: -1, dc: 0 }, // Top-Right
        { dr: 1, dc: -1 }, // Bottom-Left
        { dr: 1, dc: 0 }   // Bottom-Right
      ];
    } else {
      // Odd / offset row
      offsets = [
        { dr: 0, dc: -1 }, // Left
        { dr: 0, dc: 1 },  // Right
        { dr: -1, dc: 0 }, // Top-Left
        { dr: -1, dc: 1 }, // Top-Right
        { dr: 1, dc: 0 },  // Bottom-Left
        { dr: 1, dc: 1 }   // Bottom-Right
      ];
    }

    for (var i = 0; i < offsets.length; i++) {
      var nr = r + offsets[i].dr;
      var nc = c + offsets[i].dc;

      if (nr >= 0 && nr < this.maxRows) {
        var maxC = this.getColsForRow(nr);
        if (nc >= 0 && nc < maxC) {
          neighbors.push({ r: nr, c: nc });
        }
      }
    }

    return neighbors;
  };

  HexGrid.prototype.getBubble = function (r, c) {
    if (r < 0 || r >= this.maxRows) return null;
    if (!this.grid[r]) return null;
    if (c < 0 || c >= this.grid[r].length) return null;
    return this.grid[r][c];
  };

  HexGrid.prototype.setBubble = function (r, c, bubble) {
    if (r < 0 || r >= this.maxRows) return false;
    var maxC = this.getColsForRow(r);
    if (c < 0 || c >= maxC) return false;

    // Ensure row exists
    while (this.grid.length <= r) {
      this.grid.push([]);
    }
    while (this.grid[r].length < maxC) {
      this.grid[r].push(null);
    }

    this.grid[r][c] = bubble;
    return true;
  };

  HexGrid.prototype.removeBubble = function (r, c) {
    var bubble = this.getBubble(r, c);
    if (bubble) {
      this.grid[r][c] = null;
    }
    return bubble;
  };

  HexGrid.prototype.isEmpty = function (r, c) {
    return this.getBubble(r, c) === null;
  };

  HexGrid.prototype.getTotalBubbles = function () {
    var count = 0;
    for (var r = 0; r < this.grid.length; r++) {
      var row = this.grid[r];
      if (!row) continue;
      for (var c = 0; c < row.length; c++) {
        if (row[c] !== null) count++;
      }
    }
    return count;
  };

  HexGrid.prototype.getActiveColors = function () {
    var colorMap = {};
    var colors = [];
    for (var r = 0; r < this.grid.length; r++) {
      var row = this.grid[r];
      if (!row) continue;
      for (var c = 0; c < row.length; c++) {
        var b = row[c];
        if (b && !colorMap[b.colorId]) {
          colorMap[b.colorId] = true;
          colors.push(b.color);
        }
      }
    }
    return colors;
  };

  /**
   * Snaps projectile (x, y) to the most appropriate empty grid slot.
   * Prioritizes empty neighbor slots of existing bubbles or ceiling slots.
   */
  HexGrid.prototype.snapProjectile = function (px, py, hitBubblePos) {
    var candidates = [];

    if (hitBubblePos) {
      // Find empty neighbors around the hit bubble
      var neighbors = this.getNeighbors(hitBubblePos.r, hitBubblePos.c);
      for (var i = 0; i < neighbors.length; i++) {
        var n = neighbors[i];
        if (this.isEmpty(n.r, n.c)) {
          var nPos = this.gridToPixel(n.r, n.c);
          var dx = px - nPos.x;
          var dy = py - nPos.y;
          candidates.push({ r: n.r, c: n.c, distSq: dx * dx + dy * dy });
        }
      }
    }

    // If near ceiling, include empty row 0 cells
    if (py <= this.ceilingOffset + this.radius * 2.2) {
      var row0Cols = this.getColsForRow(0);
      for (var c0 = 0; c0 < row0Cols; c0++) {
        if (this.isEmpty(0, c0)) {
          var p0 = this.gridToPixel(0, c0);
          var d0x = px - p0.x;
          var d0y = py - p0.y;
          candidates.push({ r: 0, c: c0, distSq: d0x * d0x + d0y * d0y });
        }
      }
    }

    // If no candidate from immediate neighbors, find closest empty slot adjacent to ANY bubble
    if (candidates.length === 0) {
      for (var r = 0; r < this.maxRows; r++) {
        var numCols = this.getColsForRow(r);
        for (var c = 0; c < numCols; c++) {
          if (this.isEmpty(r, c)) {
            // Must be row 0 or neighbor of an occupied bubble
            var hasOccupiedNeighbor = (r === 0);
            if (!hasOccupiedNeighbor) {
              var nList = this.getNeighbors(r, c);
              for (var k = 0; k < nList.length; k++) {
                if (!this.isEmpty(nList[k].r, nList[k].c)) {
                  hasOccupiedNeighbor = true;
                  break;
                }
              }
            }
            if (hasOccupiedNeighbor) {
              var cellPos = this.gridToPixel(r, c);
              var cdx = px - cellPos.x;
              var cdy = py - cellPos.y;
              candidates.push({ r: r, c: c, distSq: cdx * cdx + cdy * cdy });
            }
          }
        }
      }
    }

    // Fallback: nearest grid slot
    if (candidates.length === 0) {
      var direct = this.pixelToGrid(px, py);
      return { r: direct.r, c: direct.c };
    }

    // Sort by distance squared ascending
    candidates.sort(function (a, b) {
      return a.distSq - b.distSq;
    });

    return { r: candidates[0].r, c: candidates[0].c };
  };

  /**
   * Breadth-First Search (BFS) for matching connected bubbles of the same color.
   */
  HexGrid.prototype.findMatches = function (startR, startC) {
    var targetBubble = this.getBubble(startR, startC);
    if (!targetBubble) return [];

    var targetColorId = targetBubble.colorId;
    var matches = [];
    var visited = {};
    var queue = [{ r: startR, c: startC }];
    visited[startR + ',' + startC] = true;

    while (queue.length > 0) {
      var curr = queue.shift();
      matches.push(curr);

      var neighbors = this.getNeighbors(curr.r, curr.c);
      for (var i = 0; i < neighbors.length; i++) {
        var n = neighbors[i];
        var key = n.r + ',' + n.c;
        if (!visited[key]) {
          var nb = this.getBubble(n.r, n.c);
          if (nb && nb.colorId === targetColorId) {
            visited[key] = true;
            queue.push(n);
          }
        }
      }
    }

    return matches;
  };

  /**
   * Breadth-First Search (BFS) to find floating/orphan bubbles not connected to row 0.
   */
  HexGrid.prototype.findFloatingBubbles = function () {
    var visited = {};
    var queue = [];

    // All active bubbles in row 0 are anchored to ceiling
    var row0Cols = this.getColsForRow(0);
    for (var c0 = 0; c0 < row0Cols; c0++) {
      var b0 = this.getBubble(0, c0);
      if (b0) {
        visited['0,' + c0] = true;
        queue.push({ r: 0, c: c0 });
      }
    }

    // BFS to find all bubbles reachable from ceiling
    while (queue.length > 0) {
      var curr = queue.shift();
      var neighbors = this.getNeighbors(curr.r, curr.c);
      for (var i = 0; i < neighbors.length; i++) {
        var n = neighbors[i];
        var key = n.r + ',' + n.c;
        if (!visited[key]) {
          var nb = this.getBubble(n.r, n.c);
          if (nb) {
            visited[key] = true;
            queue.push(n);
          }
        }
      }
    }

    // Any bubble on the board that was not visited is an orphan
    var orphans = [];
    for (var r = 0; r < this.grid.length; r++) {
      var row = this.grid[r];
      if (!row) continue;
      for (var c = 0; c < row.length; c++) {
        var b = row[c];
        if (b && !visited[r + ',' + c]) {
          var pos = this.gridToPixel(r, c);
          orphans.push({
            r: r,
            c: c,
            bubble: b,
            x: pos.x,
            y: pos.y
          });
        }
      }
    }

    return orphans;
  };

  /**
   * Drops ceiling penalty: inserts a new row at top and shifts rows down.
   */
  HexGrid.prototype.dropCeiling = function (availableColors) {
    if (!availableColors || availableColors.length === 0) {
      availableColors = BUBBLE_PALETTE.slice(0, 4);
    }

    // Toggle row parity so existing bubbles retain their relative column alignment
    this.rowOffsetParity = (this.rowOffsetParity + 1) % 2;

    // Create new top row
    var newCols = this.getColsForRow(0);
    var newRow = [];
    for (var c = 0; c < newCols; c++) {
      // Clustered color generation for natural feel
      var color;
      if (c > 0 && Math.random() < 0.6) {
        color = newRow[c - 1].color;
      } else {
        color = availableColors[Math.floor(Math.random() * availableColors.length)];
      }
      newRow.push(new Bubble(color));
    }

    // Insert at row 0
    this.grid.unshift(newRow);

    // Truncate to maxRows
    if (this.grid.length > this.maxRows) {
      this.grid.length = this.maxRows;
    }
  };

  /**
   * Checks if any active bubble has crossed the bottom danger line.
   */
  HexGrid.prototype.hasBreachedDangerLine = function (dangerY) {
    for (var r = 0; r < this.grid.length; r++) {
      var row = this.grid[r];
      if (!row) continue;
      for (var c = 0; c < row.length; c++) {
        if (row[c] !== null) {
          var pos = this.gridToPixel(r, c);
          if (pos.y + this.radius >= dangerY) {
            return true;
          }
        }
      }
    }
    return false;
  };

  /**
   * Populates the grid with an initial cluster-patterned board.
   */
  HexGrid.prototype.populateInitialBoard = function (rowCount, colors) {
    this.initGrid();
    this.rowOffsetParity = 0;
    this.ceilingOffset = 0;

    if (!colors || colors.length === 0) {
      colors = BUBBLE_PALETTE.slice(0, 4);
    }

    for (var r = 0; r < rowCount; r++) {
      var cols = this.getColsForRow(r);
      for (var c = 0; c < cols; c++) {
        var color = null;
        // 65% chance to cluster with existing neighbor
        var neighbors = this.getNeighbors(r, c);
        var neighborColors = [];
        for (var n = 0; n < neighbors.length; n++) {
          var nb = this.getBubble(neighbors[n].r, neighbors[n].c);
          if (nb) neighborColors.push(nb.color);
        }

        if (neighborColors.length > 0 && Math.random() < 0.65) {
          color = neighborColors[Math.floor(Math.random() * neighborColors.length)];
        } else {
          color = colors[Math.floor(Math.random() * colors.length)];
        }

        this.setBubble(r, c, new Bubble(color));
      }
    }
  };

  // ==========================================================================
  // 4. RAYCASTING & TRAJECTORY SYSTEM
  // ==========================================================================

  /**
   * Computes the ray trajectory line with wall reflections and bubble intersection.
   */
  function traceTrajectory(hexGrid, startX, startY, angle, radius, maxBounces) {
    if (typeof maxBounces === 'undefined') maxBounces = 2;

    var segments = [];
    var currX = startX;
    var currY = startY;
    var dirX = Math.cos(angle);
    var dirY = Math.sin(angle);

    var leftWall = radius;
    var rightWall = hexGrid.width - radius;
    var ceilingY = hexGrid.ceilingOffset + radius;

    var hitBubblePos = null;
    var snapPos = null;

    for (var bounce = 0; bounce <= maxBounces; bounce++) {
      // Find collision with walls
      var tWall = Infinity;
      var hitWallSide = null;

      if (dirX < -0.0001) {
        var tLeft = (leftWall - currX) / dirX;
        if (tLeft > 0.001) {
          tWall = tLeft;
          hitWallSide = 'left';
        }
      } else if (dirX > 0.0001) {
        var tRight = (rightWall - currX) / dirX;
        if (tRight > 0.001) {
          tWall = tRight;
          hitWallSide = 'right';
        }
      }

      // Find collision with ceiling
      var tCeil = Infinity;
      if (dirY < -0.0001) {
        var tC = (ceilingY - currY) / dirY;
        if (tC > 0.001) {
          tCeil = tC;
        }
      }

      // Find earliest collision with any active bubble
      // Ray-circle intersection where bubble collision radius = 2 * radius
      var tBubble = Infinity;
      var hitBubble = null;
      var colRadius = radius * 2.0;
      var colRadiusSq = colRadius * colRadius;

      for (var r = 0; r < hexGrid.grid.length; r++) {
        var row = hexGrid.grid[r];
        if (!row) continue;
        for (var c = 0; c < row.length; c++) {
          if (row[c] !== null) {
            var bPos = hexGrid.gridToPixel(r, c);
            var vx = currX - bPos.x;
            var vy = currY - bPos.y;

            // Dot product (dir . v)
            var b = dirX * vx + dirY * vy;
            var cConst = vx * vx + vy * vy - colRadiusSq;
            var discr = b * b - cConst;

            if (discr >= 0) {
              var t = -b - Math.sqrt(discr);
              if (t > 0.001 && t < tBubble) {
                tBubble = t;
                hitBubble = { r: r, c: c, x: bPos.x, y: bPos.y };
              }
            }
          }
        }
      }

      // Determine nearest intersection
      if (tBubble < tWall && tBubble < tCeil) {
        // Hits an existing bubble
        var endX = currX + dirX * tBubble;
        var endY = currY + dirY * tBubble;
        segments.push({ x1: currX, y1: currY, x2: endX, y2: endY });
        hitBubblePos = hitBubble;
        snapPos = hexGrid.snapProjectile(endX, endY, hitBubble);
        break;
      } else if (tCeil <= tWall && tCeil < tBubble) {
        // Hits ceiling
        var endXCeil = currX + dirX * tCeil;
        var endYCeil = currY + dirY * tCeil;
        segments.push({ x1: currX, y1: currY, x2: endXCeil, y2: endYCeil });
        snapPos = hexGrid.snapProjectile(endXCeil, endYCeil, null);
        break;
      } else if (tWall < Infinity) {
        // Hits wall: reflect
        var wallEndX = currX + dirX * tWall;
        var wallEndY = currY + dirY * tWall;
        segments.push({ x1: currX, y1: currY, x2: wallEndX, y2: wallEndY });

        currX = (hitWallSide === 'left') ? leftWall : rightWall;
        currY = wallEndY;
        dirX = -dirX; // Invert horizontal direction
      } else {
        // No collision within bounds
        segments.push({
          x1: currX,
          y1: currY,
          x2: currX + dirX * 300,
          y2: currY + dirY * 300
        });
        break;
      }
    }

    return {
      segments: segments,
      hitBubblePos: hitBubblePos,
      snapPos: snapPos
    };
  }

  // ==========================================================================
  // 5. VISUAL RENDERING (3D GLOSSY BUBBLES, SHADOWS, HIGHLIGHTS)
  // ==========================================================================

  function drawGlossyBubble(ctx, x, y, radius, color, alpha, scale) {
    if (typeof alpha === 'undefined') alpha = 1.0;
    if (typeof scale === 'undefined') scale = 1.0;
    if (alpha <= 0.001 || scale <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (scale !== 1.0) {
      ctx.scale(scale, scale);
    }

    // Outer glow ring
    ctx.shadowColor = color.glow || color.hex;
    ctx.shadowBlur = 9;
    ctx.beginPath();
    ctx.arc(0, 0, radius - 1, 0, Math.PI * 2);
    ctx.fillStyle = color.hex;
    ctx.fill();
    ctx.shadowBlur = 0; // Reset shadow

    // 3D Spherical Radial Gradient (light source top-left)
    var grad = ctx.createRadialGradient(
      -radius * 0.35, -radius * 0.35, radius * 0.08,
      0, 0, radius
    );
    grad.addColorStop(0, color.light);
    grad.addColorStop(0.4, color.hex);
    grad.addColorStop(0.85, color.dark);
    grad.addColorStop(1, '#050711');

    ctx.beginPath();
    ctx.arc(0, 0, radius - 1, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle crisp inner rim stroke
    ctx.beginPath();
    ctx.arc(0, 0, radius - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Primary Specular Highlight (angled glossy ellipse near top-left)
    ctx.save();
    ctx.translate(-radius * 0.36, -radius * 0.36);
    ctx.rotate(-Math.PI / 4);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.36, radius * 0.18, 0, 0, Math.PI * 2);
    var specGrad = ctx.createLinearGradient(0, -radius * 0.18, 0, radius * 0.18);
    specGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    specGrad.addColorStop(1, 'rgba(255, 255, 255, 0.15)');
    ctx.fillStyle = specGrad;
    ctx.fill();
    ctx.restore();

    // Secondary subtle bottom reflection
    ctx.beginPath();
    ctx.ellipse(radius * 0.28, radius * 0.32, radius * 0.24, radius * 0.1, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.fill();

    ctx.restore();
  }

  // ==========================================================================
  // 6. PARTICLE & JUICE SYSTEMS
  // ==========================================================================

  function ParticleSystem() {
    this.particles = [];
    this.fallingBubbles = [];
    this.floatingTexts = [];
    this.shockwaves = [];
  }

  ParticleSystem.prototype.spawnPopFragments = function (x, y, color) {
    var count = 14;
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 120 + Math.random() * 260;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 4.5,
        color: (Math.random() < 0.5) ? color.light : color.hex,
        glow: color.glow,
        life: 1.0,
        decay: 1.6 + Math.random() * 1.2,
        gravity: 280
      });
    }

    // Shockwave ring
    this.shockwaves.push({
      x: x,
      y: y,
      radius: 6,
      maxRadius: 42,
      color: color.hex,
      alpha: 0.9,
      decay: 2.2
    });
  };

  ParticleSystem.prototype.spawnFallingBubble = function (x, y, color) {
    this.fallingBubbles.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 160,
      vy: -80 - Math.random() * 80, // Initial upward hop
      color: color,
      gravity: 950,
      rotation: 0,
      vRot: (Math.random() - 0.5) * 10,
      bounces: 0,
      alpha: 1.0
    });
  };

  ParticleSystem.prototype.spawnFloatingText = function (text, x, y, color, isCombo) {
    this.floatingTexts.push({
      text: text,
      x: x,
      y: y,
      vy: -60,
      color: color || '#ffe600',
      alpha: 1.0,
      life: 1.0,
      decay: isCombo ? 0.75 : 1.1,
      scale: isCombo ? 1.4 : 1.1,
      isCombo: !!isCombo
    });
  };

  ParticleSystem.prototype.update = function (dt) {
    // 1. Fragments
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.life -= p.decay * dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // 2. Shockwaves
    for (var s = this.shockwaves.length - 1; s >= 0; s--) {
      var sw = this.shockwaves[s];
      sw.radius += (sw.maxRadius - sw.radius) * 10 * dt;
      sw.alpha -= sw.decay * dt;
      if (sw.alpha <= 0) {
        this.shockwaves.splice(s, 1);
      }
    }

    // 3. Falling orphan bubbles
    for (var f = this.fallingBubbles.length - 1; f >= 0; f--) {
      var fb = this.fallingBubbles[f];
      fb.x += fb.vx * dt;
      fb.y += fb.vy * dt;
      fb.vy += fb.gravity * dt;
      fb.rotation += fb.vRot * dt;

      // Ground bounce
      if (fb.y >= CANVAS_HEIGHT - BUBBLE_RADIUS && fb.bounces === 0) {
        fb.y = CANVAS_HEIGHT - BUBBLE_RADIUS;
        fb.vy = -fb.vy * 0.45;
        fb.bounces++;
      }

      if (fb.y > CANVAS_HEIGHT + 60) {
        this.fallingBubbles.splice(f, 1);
      }
    }

    // 4. Floating text popups
    for (var t = this.floatingTexts.length - 1; t >= 0; t--) {
      var ft = this.floatingTexts[t];
      ft.y += ft.vy * dt;
      ft.vy *= 0.94;
      ft.life -= ft.decay * dt;
      ft.alpha = Math.max(0, ft.life);
      if (ft.life <= 0) {
        this.floatingTexts.splice(t, 1);
      }
    }
  };

  ParticleSystem.prototype.draw = function (ctx) {
    // 1. Shockwaves
    for (var s = 0; s < this.shockwaves.length; s++) {
      var sw = this.shockwaves[s];
      ctx.save();
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.strokeStyle = sw.color;
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.lineWidth = 2.5;
      ctx.shadowColor = sw.color;
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    }

    // 2. Particles
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.shadowColor = p.glow || p.color;
      ctx.shadowBlur = 6;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Falling orphan bubbles
    for (var f = 0; f < this.fallingBubbles.length; f++) {
      var fb = this.fallingBubbles[f];
      drawGlossyBubble(ctx, fb.x, fb.y, BUBBLE_RADIUS * 0.92, fb.color, fb.alpha, 1.0);
    }

    // 4. Floating texts
    for (var t = 0; t < this.floatingTexts.length; t++) {
      var ft = this.floatingTexts[t];
      ctx.save();
      ctx.globalAlpha = ft.alpha;
      ctx.font = ft.isCombo ? "bold 15px 'Press Start 2P', monospace" : "bold 13px 'Press Start 2P', monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Outline
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#04050b';
      ctx.strokeText(ft.text, ft.x, ft.y);

      // Glow fill
      ctx.shadowColor = ft.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  };

  // ==========================================================================
  // 7. BUBBLE SHOOTER GAME ENGINE
  // ==========================================================================

  function BubbleShooterGame() {
    this.canvas = null;
    this.ctx = null;
    this.nextCanvas = null;
    this.nextCtx = null;

    this.grid = new HexGrid(GRID_COLS, BUBBLE_RADIUS, MAX_ROWS, CANVAS_WIDTH, CANVAS_HEIGHT);
    this.particles = new ParticleSystem();

    // Game state: 'start', 'playing', 'paused', 'gameover', 'win'
    this.state = 'start';
    this.level = 1;
    this.score = 0;
    this.highScore = 0;
    this.combo = 0;

    // Ceiling Drop / Penalty system
    this.maxMisses = 5;
    this.missesRemaining = 5;

    // Shooter cannon state
    this.cannonAngle = -Math.PI / 2; // Aiming straight up (-90 deg)
    this.targetAngle = -Math.PI / 2;
    this.currentBubble = null;
    this.nextBubble = null;
    this.isShooting = false;
    this.projectile = null;
    this.recoilOffset = 0;

    // Screen Shake
    this.shakeIntensity = 0;
    this.shakeX = 0;
    this.shakeY = 0;

    // Trajectory animation
    this.dashOffset = 0;

    // Loop
    this.lastTime = 0;
    this.animationFrameId = null;

    // DOM Element Cache
    this.dom = {};
  }

  BubbleShooterGame.prototype.init = function () {
    this.loadHighScore();
    this.cacheDomElements();
    this.setupCanvases();
    this.bindEvents();
    this.bindHudButtons();

    // Start with pre-rendered board in background behind start modal
    this.startLevel(1, false);

    // Initial render
    this.render();

    // Start game loop
    this.lastTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var self = this;
    var raf = (typeof requestAnimationFrame !== 'undefined')
      ? requestAnimationFrame
      : function (cb) { return setTimeout(cb, 16); };

    function loop(time) {
      self.update(time || ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()));
      self.render();
      self.animationFrameId = raf(loop);
    }
    this.animationFrameId = raf(loop);
  };

  BubbleShooterGame.prototype.loadHighScore = function () {
    try {
      if (typeof localStorage !== 'undefined') {
        var saved = localStorage.getItem(HIGH_SCORE_KEY);
        this.highScore = saved ? (parseInt(saved, 10) || 0) : 0;
      }
    } catch (e) {
      this.highScore = 0;
    }
  };

  BubbleShooterGame.prototype.saveHighScore = function () {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(HIGH_SCORE_KEY, this.highScore.toString());
        }
      } catch (e) {}
    }
    this.updateHud();
  };

  BubbleShooterGame.prototype.cacheDomElements = function () {
    if (typeof document === 'undefined') return;

    this.dom = {
      canvas: document.getElementById('game-canvas'),
      nextCanvas: document.getElementById('next-bubble-canvas'),
      score: document.getElementById('score'),
      highScore: document.getElementById('high-score'),
      level: document.getElementById('level'),
      missCounter: document.getElementById('miss-counter'),
      missIndicators: document.getElementById('miss-indicators'),

      // Modals
      startModal: document.getElementById('start-modal'),
      pauseModal: document.getElementById('pause-modal'),
      gameOverModal: document.getElementById('game-over-modal'),
      victoryModal: document.getElementById('victory-modal'),

      // Modal score displays
      finalScore: document.getElementById('final-score'),
      finalHighScore: document.getElementById('final-high-score'),
      victoryScore: document.getElementById('victory-score'),

      // Buttons
      btnStart: document.getElementById('btn-start'),
      btnPause: document.getElementById('btn-pause'),
      btnResume: document.getElementById('btn-resume'),
      btnRestart: document.getElementById('btn-restart'),
      btnPauseRestart: document.getElementById('btn-pause-restart'),
      btnPlayAgain: document.getElementById('btn-play-again'),
      btnNextLevel: document.getElementById('btn-next-level'),
      btnVictoryRestart: document.getElementById('btn-victory-restart'),
      btnMute: document.getElementById('btn-mute')
    };
  };

  BubbleShooterGame.prototype.setupCanvases = function () {
    if (!this.dom.canvas) return;

    this.canvas = this.dom.canvas;
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext('2d');

    if (this.dom.nextCanvas) {
      this.nextCanvas = this.dom.nextCanvas;
      this.nextCanvas.width = 44;
      this.nextCanvas.height = 44;
      this.nextCtx = this.nextCanvas.getContext('2d');
    }
  };

  BubbleShooterGame.prototype.getAvailableColorsForLevel = function (lvl) {
    if (lvl <= 1) return BUBBLE_PALETTE.slice(0, 4); // 4 colors
    if (lvl <= 2) return BUBBLE_PALETTE.slice(0, 5); // 5 colors
    return BUBBLE_PALETTE.slice(0, 6); // All 6 colors
  };

  BubbleShooterGame.prototype.pickBubbleColor = function () {
    var activeColors = this.grid.getActiveColors();
    if (activeColors.length > 0) {
      return activeColors[Math.floor(Math.random() * activeColors.length)];
    }
    var lvlColors = this.getAvailableColorsForLevel(this.level);
    return lvlColors[Math.floor(Math.random() * lvlColors.length)];
  };

  BubbleShooterGame.prototype.startLevel = function (lvl, setPlaying) {
    if (typeof setPlaying === 'undefined') setPlaying = true;
    this.level = lvl;
    this.combo = 0;
    this.maxMisses = Math.max(3, 6 - Math.floor(lvl / 2));
    this.missesRemaining = this.maxMisses;
    this.isShooting = false;
    this.projectile = null;

    var initialRows = Math.min(8, 4 + lvl);
    var colors = this.getAvailableColorsForLevel(lvl);
    this.grid.populateInitialBoard(initialRows, colors);

    this.currentBubble = new Bubble(this.pickBubbleColor());
    this.nextBubble = new Bubble(this.pickBubbleColor());

    if (setPlaying) {
      this.state = 'playing';
      this.hideAllModals();
    }
    this.updateHud();
    this.renderNextBubblePreview();
  };

  BubbleShooterGame.prototype.start = function () {
    safeAudio('init');
    this.score = 0;
    this.startLevel(1, true);
  };

  BubbleShooterGame.prototype.pause = function () {
    if (this.state === 'playing') {
      this.state = 'paused';
      this.showModal(this.dom.pauseModal);
      if (this.dom.btnPause) this.dom.btnPause.classList.add('paused');
    }
  };

  BubbleShooterGame.prototype.resume = function () {
    if (this.state === 'paused') {
      this.state = 'playing';
      this.hideAllModals();
      if (this.dom.btnPause) this.dom.btnPause.classList.remove('paused');
    }
  };

  BubbleShooterGame.prototype.togglePause = function () {
    if (this.state === 'playing') {
      this.pause();
    } else if (this.state === 'paused') {
      this.resume();
    }
  };

  BubbleShooterGame.prototype.restart = function () {
    safeAudio('init');
    this.score = 0;
    this.startLevel(1, true);
  };

  BubbleShooterGame.prototype.nextLevel = function () {
    this.startLevel(this.level + 1, true);
  };

  BubbleShooterGame.prototype.swapBubbles = function () {
    if (this.isShooting || this.state !== 'playing') return;
    var temp = this.currentBubble;
    this.currentBubble = this.nextBubble;
    this.nextBubble = temp;
    safeAudio('playBounce');
    this.renderNextBubblePreview();
  };

  BubbleShooterGame.prototype.shoot = function () {
    if (this.isShooting || this.state !== 'playing' || !this.currentBubble) return;

    safeAudio('init');
    safeAudio('playShoot');

    this.isShooting = true;
    this.recoilOffset = 8; // Cannon kicks back

    this.projectile = {
      x: SHOOTER_X,
      y: SHOOTER_Y,
      vx: Math.cos(this.cannonAngle) * PROJECTILE_SPEED,
      vy: Math.sin(this.cannonAngle) * PROJECTILE_SPEED,
      color: this.currentBubble.color,
      colorId: this.currentBubble.colorId
    };
  };

  // ==========================================================================
  // 8. EVENT LISTENERS & INPUT
  // ==========================================================================

  BubbleShooterGame.prototype.bindEvents = function () {
    if (typeof window === 'undefined' || !this.canvas) return;

    var self = this;

    // Helper to calculate canvas mouse/touch coordinates
    function getCanvasCoords(e) {
      var rect = self.canvas.getBoundingClientRect();
      var clientX = e.clientX;
      var clientY = e.clientY;

      if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      }

      var scaleX = CANVAS_WIDTH / rect.width;
      var scaleY = CANVAS_HEIGHT / rect.height;

      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    }

    function updateAim(coords) {
      var dx = coords.x - SHOOTER_X;
      var dy = coords.y - SHOOTER_Y;
      var angle = Math.atan2(dy, dx);

      // Clamp angle: prevent aiming below horizontal line
      // Valid upward angles: -170 deg (-2.96 rad) to -10 deg (-0.17 rad)
      var minAngle = -Math.PI + 0.17;
      var maxAngle = -0.17;

      if (angle > 0) {
        // Aiming downwards: clamp to closest side
        angle = (coords.x < SHOOTER_X) ? minAngle : maxAngle;
      } else {
        if (angle < minAngle) angle = minAngle;
        if (angle > maxAngle) angle = maxAngle;
      }

      self.targetAngle = angle;
      self.cannonAngle = angle;
    }

    // Pointer Move
    this.canvas.addEventListener('mousemove', function (e) {
      updateAim(getCanvasCoords(e));
    });

    this.canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var coords = getCanvasCoords(e);
      updateAim(coords);
      if (self.state === 'start') {
        self.start();
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      updateAim(getCanvasCoords(e));
    }, { passive: false });

    // Pointer Down / Click to Fire or Start
    this.canvas.addEventListener('mousedown', function (e) {
      if (e.button === 0) {
        var coords = getCanvasCoords(e);
        updateAim(coords);
        if (self.state === 'start') {
          self.start();
        } else if (self.state === 'playing') {
          self.shoot();
        }
      } else if (e.button === 2) {
        // Right click to swap bubbles
        e.preventDefault();
        self.swapBubbles();
      }
    });

    this.canvas.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    this.canvas.addEventListener('touchend', function (e) {
      e.preventDefault();
      if (self.state === 'start') {
        self.start();
      } else if (self.state === 'playing') {
        self.shoot();
      }
    }, { passive: false });

    // Keyboard Shortcuts
    window.addEventListener('keydown', function (e) {
      var key = e.key.toUpperCase();

      // If at start screen, Space, Enter, or arrows starts game
      if (self.state === 'start') {
        if (key === ' ' || key === 'ENTER' || key === 'SPACEBAR' || key === 'ARROWUP' || key === 'ARROWLEFT' || key === 'ARROWRIGHT') {
          e.preventDefault();
          self.start();
          return;
        }
      }

      // If game over or victory, Enter or Space restarts
      if (self.state === 'gameover' || self.state === 'victory') {
        if (key === ' ' || key === 'ENTER') {
          e.preventDefault();
          self.restart();
          return;
        }
      }

      if (key === 'P' || key === 'ESCAPE') {
        self.togglePause();
      } else if (key === 'M') {
        self.toggleMute();
      } else if (key === 'R') {
        self.restart();
      } else if (key === 'C' || key === ' ') {
        self.swapBubbles();
      }
    });

    // Next bubble card click to swap
    if (this.dom.nextCanvas) {
      this.dom.nextCanvas.addEventListener('click', function () {
        self.swapBubbles();
      });
    }
  };

  BubbleShooterGame.prototype.bindHudButtons = function () {
    var self = this;

    // Clicking anywhere on the start modal starts the game
    if (this.dom.startModal) {
      this.dom.startModal.addEventListener('click', function () {
        self.start();
      });
      this.dom.startModal.style.cursor = 'pointer';
    }

    if (this.dom.btnStart) {
      this.dom.btnStart.addEventListener('click', function (e) {
        e.stopPropagation();
        self.start();
      });
    }

    if (this.dom.btnPause) {
      this.dom.btnPause.addEventListener('click', function () {
        self.togglePause();
      });
    }

    if (this.dom.btnResume) {
      this.dom.btnResume.addEventListener('click', function () {
        self.resume();
      });
    }

    if (this.dom.btnRestart) {
      this.dom.btnRestart.addEventListener('click', function () {
        self.restart();
      });
    }

    if (this.dom.btnPauseRestart) {
      this.dom.btnPauseRestart.addEventListener('click', function () {
        self.restart();
      });
    }

    if (this.dom.btnPlayAgain) {
      this.dom.btnPlayAgain.addEventListener('click', function () {
        self.restart();
      });
    }

    if (this.dom.btnNextLevel) {
      this.dom.btnNextLevel.addEventListener('click', function () {
        self.nextLevel();
      });
    }

    if (this.dom.btnVictoryRestart) {
      this.dom.btnVictoryRestart.addEventListener('click', function () {
        self.restart();
      });
    }

    if (this.dom.btnMute) {
      this.dom.btnMute.addEventListener('click', function () {
        self.toggleMute();
      });
    }
  };

  BubbleShooterGame.prototype.toggleMute = function () {
    safeAudio('init');
    var isMuted = safeAudio('toggleMute');
    if (this.dom.btnMute) {
      this.dom.btnMute.classList.toggle('muted', !!isMuted);
    }
  };

  // ==========================================================================
  // 9. MODALS & HUD UPDATES
  // ==========================================================================

  BubbleShooterGame.prototype.hideAllModals = function () {
    var modals = [
      this.dom.startModal,
      this.dom.pauseModal,
      this.dom.gameOverModal,
      this.dom.victoryModal
    ];
    for (var i = 0; i < modals.length; i++) {
      if (modals[i]) modals[i].classList.remove('active');
    }
  };

  BubbleShooterGame.prototype.showModal = function (modalElement) {
    this.hideAllModals();
    if (modalElement) {
      modalElement.classList.add('active');
    }
  };

  BubbleShooterGame.prototype.updateHud = function () {
    if (this.dom.score) this.dom.score.textContent = this.score;
    if (this.dom.highScore) this.dom.highScore.textContent = this.highScore;
    if (this.dom.level) this.dom.level.textContent = this.level;
    if (this.dom.missCounter) this.dom.missCounter.textContent = this.missesRemaining;

    // Update miss indicator dots
    if (this.dom.missIndicators) {
      var dots = this.dom.missIndicators.querySelectorAll('.miss-dot');
      for (var d = 0; d < dots.length; d++) {
        dots[d].classList.toggle('active', d < this.missesRemaining);
      }
    }
  };

  BubbleShooterGame.prototype.renderNextBubblePreview = function () {
    if (!this.nextCtx || !this.nextBubble) return;
    this.nextCtx.clearRect(0, 0, 44, 44);
    drawGlossyBubble(this.nextCtx, 22, 22, 17, this.nextBubble.color, 1.0, 1.0);
  };

  // ==========================================================================
  // 10. GAME LOOP: UPDATE & RESOLVE
  // ==========================================================================

  BubbleShooterGame.prototype.update = function (currentTime) {
    var dt = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    // Cap delta time to prevent tunneling on frame drops
    if (dt > 0.05) dt = 0.05;

    // Recoil recovery
    if (this.recoilOffset > 0) {
      this.recoilOffset = Math.max(0, this.recoilOffset - 40 * dt);
    }

    // Trajectory dash animation
    this.dashOffset = (this.dashOffset - 40 * dt) % 24;

    // Screen shake decay
    if (this.shakeIntensity > 0) {
      this.shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= 0.88;
      if (this.shakeIntensity < 0.2) {
        this.shakeIntensity = 0;
        this.shakeX = 0;
        this.shakeY = 0;
      }
    }

    // Particle system update
    this.particles.update(dt);

    if (this.state !== 'playing') return;

    // Projectile Physics Update
    if (this.isShooting && this.projectile) {
      this.updateProjectile(dt);
    }
  };

  BubbleShooterGame.prototype.updateProjectile = function (dt) {
    var proj = this.projectile;
    var subSteps = 4;
    var subDt = dt / subSteps;

    for (var step = 0; step < subSteps; step++) {
      proj.x += proj.vx * subDt;
      proj.y += proj.vy * subDt;

      // 1. Left wall bounce
      if (proj.x <= BUBBLE_RADIUS) {
        proj.x = BUBBLE_RADIUS;
        proj.vx = -proj.vx;
        safeAudio('playBounce');
      }

      // 2. Right wall bounce
      if (proj.x >= CANVAS_WIDTH - BUBBLE_RADIUS) {
        proj.x = CANVAS_WIDTH - BUBBLE_RADIUS;
        proj.vx = -proj.vx;
        safeAudio('playBounce');
      }

      // 3. Top ceiling collision
      if (proj.y <= this.grid.ceilingOffset + BUBBLE_RADIUS) {
        this.resolveProjectileImpact(proj.x, proj.y, null);
        return;
      }

      // 4. Bubble collision
      var hitBubble = null;
      var minDistSq = (BUBBLE_RADIUS * 1.95) * (BUBBLE_RADIUS * 1.95);

      for (var r = 0; r < this.grid.grid.length; r++) {
        var row = this.grid.grid[r];
        if (!row) continue;
        for (var c = 0; c < row.length; c++) {
          if (row[c] !== null) {
            var bPos = this.grid.gridToPixel(r, c);
            var dx = proj.x - bPos.x;
            var dy = proj.y - bPos.y;
            var distSq = dx * dx + dy * dy;

            if (distSq <= minDistSq) {
              hitBubble = { r: r, c: c, x: bPos.x, y: bPos.y };
              break;
            }
          }
        }
        if (hitBubble) break;
      }

      if (hitBubble) {
        this.resolveProjectileImpact(proj.x, proj.y, hitBubble);
        return;
      }
    }
  };

  BubbleShooterGame.prototype.resolveProjectileImpact = function (px, py, hitBubble) {
    // Snap projectile into closest valid empty slot
    var snap = this.grid.snapProjectile(px, py, hitBubble);
    var newBubble = new Bubble(this.projectile.color);
    this.grid.setBubble(snap.r, snap.c, newBubble);

    this.isShooting = false;
    this.projectile = null;

    // 1. Check Match-3 flood fill
    var matches = this.grid.findMatches(snap.r, snap.c);

    if (matches.length >= 3) {
      // SUCCESSFUL POP!
      this.combo++;
      safeAudio('playPop', this.combo);

      var popScore = matches.length * 100 * this.combo;
      this.score += popScore;

      // Pop particles
      var avgX = 0, avgY = 0;
      for (var m = 0; m < matches.length; m++) {
        var pos = this.grid.gridToPixel(matches[m].r, matches[m].c);
        avgX += pos.x;
        avgY += pos.y;
        this.particles.spawnPopFragments(pos.x, pos.y, newBubble.color);
        this.grid.removeBubble(matches[m].r, matches[m].c);
      }
      avgX /= matches.length;
      avgY /= matches.length;

      var popupText = '+' + popScore;
      if (this.combo > 1) {
        popupText += ' (x' + this.combo + ')';
      }
      this.particles.spawnFloatingText(popupText, avgX, avgY, newBubble.color.hex, this.combo > 1);

      if (this.combo >= 2 || matches.length >= 4) {
        this.shakeIntensity = Math.min(12, 4 + this.combo * 2);
      }

      // 2. Check Floating/Orphan Bubbles
      var orphans = this.grid.findFloatingBubbles();
      if (orphans.length > 0) {
        safeAudio('playDrop', orphans.length);
        var orphanScore = orphans.length * 200 * (this.combo + 1);
        this.score += orphanScore;

        for (var o = 0; o < orphans.length; o++) {
          this.grid.removeBubble(orphans[o].r, orphans[o].c);
          this.particles.spawnFallingBubble(orphans[o].x, orphans[o].y, orphans[o].bubble.color);
        }

        this.particles.spawnFloatingText('+' + orphanScore + ' DROPPED!', avgX, avgY + 30, '#00f0ff', true);
        this.shakeIntensity = Math.max(this.shakeIntensity, 8);
      }

      // Check Victory Condition: Board Cleared!
      if (this.grid.getTotalBubbles() === 0) {
        this.handleVictory();
        return;
      }

    } else {
      // MISSED POP: Penalty Counter
      this.combo = 0;
      this.missesRemaining--;

      if (this.missesRemaining <= 0) {
        // Ceiling Drops!
        safeAudio('playCeilingDrop');
        this.shakeIntensity = 14;

        var activeColors = this.grid.getActiveColors();
        this.grid.dropCeiling(activeColors);

        this.particles.spawnFloatingText('CEILING DROP!', CANVAS_WIDTH / 2, 100, '#ff2a6d', true);

        // Reset miss counter
        this.missesRemaining = this.maxMisses;
      }
    }

    // Check Danger Line Breach: Game Over!
    if (this.grid.hasBreachedDangerLine(DANGER_Y)) {
      this.handleGameOver();
      return;
    }

    // Load next bubble
    this.currentBubble = this.nextBubble;
    this.nextBubble = new Bubble(this.pickBubbleColor());
    this.updateHud();
    this.renderNextBubblePreview();
  };

  BubbleShooterGame.prototype.handleVictory = function () {
    this.state = 'win';
    safeAudio('playVictory');
    this.score += 5000 * this.level;
    this.saveHighScore();

    if (this.dom.victoryScore) this.dom.victoryScore.textContent = this.score;
    this.showModal(this.dom.victoryModal);
  };

  BubbleShooterGame.prototype.handleGameOver = function () {
    this.state = 'gameover';
    safeAudio('playGameOver');
    this.shakeIntensity = 18;
    this.saveHighScore();

    if (this.dom.finalScore) this.dom.finalScore.textContent = this.score;
    if (this.dom.finalHighScore) this.dom.finalHighScore.textContent = this.highScore;
    this.showModal(this.dom.gameOverModal);
  };

  // ==========================================================================
  // 11. RENDERING PIPELINE
  // ==========================================================================

  BubbleShooterGame.prototype.render = function () {
    if (!this.ctx) return;
    var ctx = this.ctx;

    ctx.save();

    // Clear background
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Apply Screen Shake
    if (this.shakeIntensity > 0) {
      ctx.translate(this.shakeX, this.shakeY);
    }

    // 1. Draw Ceiling Hazard Bar
    this.drawCeilingBar(ctx);

    // 2. Draw Danger Line
    this.drawDangerLine(ctx);

    // 3. Draw Active Grid Bubbles
    for (var r = 0; r < this.grid.grid.length; r++) {
      var row = this.grid.grid[r];
      if (!row) continue;
      for (var c = 0; c < row.length; c++) {
        var b = row[c];
        if (b) {
          var pos = this.grid.gridToPixel(r, c);
          drawGlossyBubble(ctx, pos.x, pos.y, BUBBLE_RADIUS, b.color, b.alpha, b.scale);
        }
      }
    }

    // 4. Draw Aiming Trajectory Raycast (when playing & not shooting)
    if (this.state === 'playing' && !this.isShooting && this.currentBubble) {
      this.drawTrajectory(ctx);
    }

    // 5. Draw Flying Projectile
    if (this.isShooting && this.projectile) {
      drawGlossyBubble(ctx, this.projectile.x, this.projectile.y, BUBBLE_RADIUS, this.projectile.color, 1.0, 1.0);
    }

    // 6. Draw Shooter Turret & Base
    this.drawShooter(ctx);

    // 7. Draw Particles, Shockwaves, Falling Bubbles, Popups
    this.particles.draw(ctx);

    ctx.restore();
  };

  BubbleShooterGame.prototype.drawCeilingBar = function (ctx) {
    var ceilY = this.grid.ceilingOffset;
    ctx.save();

    // Hazard bar background
    var barHeight = 14;
    var grad = ctx.createLinearGradient(0, ceilY - barHeight, 0, ceilY);
    grad.addColorStop(0, '#0a0d1a');
    grad.addColorStop(1, '#1e284a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, ceilY - barHeight, CANVAS_WIDTH, barHeight);

    // Glowing bottom edge
    ctx.strokeStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, ceilY);
    ctx.lineTo(CANVAS_WIDTH, ceilY);
    ctx.stroke();

    // Hazard diagonal stripes
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 42, 109, 0.45)';
    ctx.lineWidth = 3;
    for (var x = -barHeight; x < CANVAS_WIDTH + barHeight; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, ceilY - barHeight);
      ctx.lineTo(x + barHeight, ceilY);
      ctx.stroke();
    }

    ctx.restore();
  };

  BubbleShooterGame.prototype.drawDangerLine = function (ctx) {
    ctx.save();

    // Check how close lowest bubble is to danger line
    var lowestY = 0;
    for (var r = 0; r < this.grid.grid.length; r++) {
      var row = this.grid.grid[r];
      if (!row) continue;
      for (var c = 0; c < row.length; c++) {
        if (row[c]) {
          var pos = this.grid.gridToPixel(r, c);
          if (pos.y + BUBBLE_RADIUS > lowestY) lowestY = pos.y + BUBBLE_RADIUS;
        }
      }
    }

    var dangerProximity = Math.max(0, Math.min(1, (lowestY - (DANGER_Y - 100)) / 100));
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    var pulse = (Math.sin(now * 0.006) + 1) * 0.5;

    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = dangerProximity > 0.6
      ? 'rgba(255, 42, 109, ' + (0.4 + pulse * 0.5) + ')'
      : 'rgba(255, 42, 109, 0.25)';
    ctx.shadowColor = '#ff2a6d';
    ctx.shadowBlur = dangerProximity > 0.6 ? 12 : 4;
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(0, DANGER_Y);
    ctx.lineTo(CANVAS_WIDTH, DANGER_Y);
    ctx.stroke();

    if (dangerProximity > 0.7) {
      ctx.font = "8px 'Press Start 2P', monospace";
      ctx.fillStyle = 'rgba(255, 42, 109, ' + (0.6 + pulse * 0.4) + ')';
      ctx.textAlign = 'right';
      ctx.fillText('DANGER ZONE', CANVAS_WIDTH - 12, DANGER_Y - 6);
    }

    ctx.restore();
  };

  BubbleShooterGame.prototype.drawTrajectory = function (ctx) {
    var traj = traceTrajectory(
      this.grid,
      SHOOTER_X,
      SHOOTER_Y,
      this.cannonAngle,
      BUBBLE_RADIUS,
      2
    );

    ctx.save();
    ctx.setLineDash([6, 12]);
    ctx.lineDashOffset = this.dashOffset;
    ctx.strokeStyle = this.currentBubble.color.glow || 'rgba(0, 240, 255, 0.6)';
    ctx.shadowColor = this.currentBubble.color.hex;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.5;

    for (var s = 0; s < traj.segments.length; s++) {
      var seg = traj.segments[s];
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    // Ghost bubble indicator at projected landing slot
    if (traj.snapPos) {
      var targetPos = this.grid.gridToPixel(traj.snapPos.r, traj.snapPos.c);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = this.currentBubble.color.hex;
      ctx.fillStyle = this.currentBubble.color.glow;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(targetPos.x, targetPos.y, BUBBLE_RADIUS - 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  };

  BubbleShooterGame.prototype.drawShooter = function (ctx) {
    ctx.save();

    // 1. Shooter Pedestal Base
    ctx.shadowColor = 'rgba(0, 240, 255, 0.4)';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(SHOOTER_X, SHOOTER_Y + 16, 42, 0, Math.PI * 2);
    ctx.fillStyle = '#0f1424';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 2. Rotating Cannon Barrel with Recoil
    ctx.save();
    ctx.translate(SHOOTER_X, SHOOTER_Y);
    ctx.rotate(this.cannonAngle + Math.PI / 2); // Angle relative to straight up

    var barrelLength = 48 - this.recoilOffset;
    var barrelWidth = 26;

    // Barrel gradient
    var barrelGrad = ctx.createLinearGradient(-barrelWidth / 2, 0, barrelWidth / 2, 0);
    barrelGrad.addColorStop(0, '#16213e');
    barrelGrad.addColorStop(0.5, '#2e3a59');
    barrelGrad.addColorStop(1, '#16213e');

    ctx.fillStyle = barrelGrad;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
    ctx.lineWidth = 1.5;

    // Barrel rounded rectangle
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(-barrelWidth / 2, -barrelLength, barrelWidth, barrelLength, [6, 6, 0, 0]);
    } else {
      ctx.rect(-barrelWidth / 2, -barrelLength, barrelWidth, barrelLength);
    }
    ctx.fill();
    ctx.stroke();

    // Muzzle ring
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 8;
    ctx.fillRect(-barrelWidth / 2 - 2, -barrelLength - 2, barrelWidth + 4, 4);
    ctx.shadowBlur = 0;

    ctx.restore();

    // 3. Loaded Bubble in Cannon
    if (this.currentBubble && !this.isShooting) {
      drawGlossyBubble(ctx, SHOOTER_X, SHOOTER_Y, BUBBLE_RADIUS, this.currentBubble.color, 1.0, 1.0);
    }

    // 4. Secondary Next-Bubble Pad on canvas (left of shooter)
    var nextX = SHOOTER_X - 70;
    var nextY = SHOOTER_Y + 10;
    ctx.beginPath();
    ctx.arc(nextX, nextY, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    if (this.nextBubble) {
      drawGlossyBubble(ctx, nextX, nextY, 16, this.nextBubble.color, 0.85, 1.0);
    }

    // Swap label hint
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.textAlign = 'center';
    ctx.fillText('SWAP', nextX, nextY + 30);

    ctx.restore();
  };

  // ==========================================================================
  // 12. EXPORTS
  // ==========================================================================

  return {
    HexGrid: HexGrid,
    Bubble: Bubble,
    BUBBLE_PALETTE: BUBBLE_PALETTE,
    BubbleShooterGame: BubbleShooterGame,
    GRID_COLS: GRID_COLS,
    BUBBLE_RADIUS: BUBBLE_RADIUS,
    ROW_HEIGHT: ROW_HEIGHT,
    MAX_ROWS: MAX_ROWS,
    CANVAS_WIDTH: CANVAS_WIDTH,
    CANVAS_HEIGHT: CANVAS_HEIGHT,
    DANGER_Y: DANGER_Y
  };
});
