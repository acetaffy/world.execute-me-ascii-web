// MV.Renderer — draws MV.Canvas cell grids onto a 2D canvas (browser only).
//
// The terminal cell grid maps 1:1 to a fixed pixel grid: cellW is measured
// from the font's own 'M' advance, cellH is twice cellW (the terminal's 2:1
// cell aspect), so every ellipse and box-drawing line keeps its shape. Wide
// (East-Asian) glyphs are scaled horizontally to exactly two cells; the
// shade blocks █▓▒░ and the half blocks ▌▐ are drawn as rectangles instead
// of font glyphs — the same trick terminals use and immune to font gaps.
(function (root) { 'use strict';
var MV = root.MV || (root.MV = {});
var py = MV.py;

var FONT_STACK = '"Cascadia Mono","Consolas","SF Mono","Menlo","Monaco",' +
  '"DejaVu Sans Mono","Liberation Mono","Microsoft YaHei","PingFang SC",' +
  '"Noto Sans CJK SC",monospace';
var TARGET_COLS = 160;   // the terminal version's sweet spot (README: 128x44+)
var MAX_COLS = 240, MAX_ROWS = 85;
var RECT_GLYPHS = { '█': 1.0, '▓': 0.75, '▒': 0.5, '░': 0.25 };
var HALF_LEFT = { '▌': [0, 0.5], '▐': [0.5, 1] };

function Renderer(canvas) {
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  // Outside the title takeover the frame is drawn one cell lower so the
  // header is not hidden under a phone's status bar / notch; the takeover
  // (MV.TITLE_WINDOW) fills edge to edge, and player.js toggles this per
  // frame accordingly.
  this.rowOffset = 1;
  this.advRatio = 0.6;
  this.capRatio = 0.72;
  this.measureRatios();
  this.cols = 0; this.rows = 0;
  this.cellW = 8; this.cellH = 16; this.fontPx = 13;
  this.widthCache = {};
}

Renderer.prototype.measureRatios = function () {
  var ctx = this.ctx;
  var previous = ctx.font;
  ctx.font = '100px ' + FONT_STACK;
  this.advRatio = ctx.measureText('M').width / 100 || 0.6;
  var cap = ctx.measureText('H').actualBoundingBoxAscent;
  this.capRatio = cap ? cap / 100 : 0.72;
  ctx.font = previous;
};

Renderer.prototype.layout = function (availWidth, availHeight) {
  // The 5px floor keeps phone screens legible (fewer, larger columns).
  var cellW = Math.max(5, Math.floor(availWidth / TARGET_COLS));
  var cols = Math.min(MAX_COLS, Math.floor(availWidth / cellW));
  var cellH = cellW * 2;
  var rows = Math.min(MAX_ROWS, Math.floor(availHeight / cellH));
  this.cellW = cellW; this.cellH = cellH;
  this.cols = Math.max(1, cols); this.rows = Math.max(1, rows);
  this.fontPx = cellW / this.advRatio;
  var dpr = root.devicePixelRatio || 1;
  this.canvas.width = Math.round(this.cols * cellW * dpr);
  this.canvas.height = Math.round(this.rows * cellH * dpr);
  this.canvas.style.width = (this.cols * cellW) + 'px';
  this.canvas.style.height = (this.rows * cellH) + 'px';
  this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.widthCache = {};
  return { cols: this.cols, rows: this.rows };
};

Renderer.prototype.fontFor = function (bold) {
  return (bold ? '700 ' : '') + this.fontPx + 'px ' + FONT_STACK;
};

Renderer.prototype.glyphWidth = function (ch, bold) {
  var key = (bold ? 'b' : 'n') + ch;
  if (this.widthCache[key] === undefined) {
    this.ctx.font = this.fontFor(bold);
    this.widthCache[key] = this.ctx.measureText(ch).width;
  }
  return this.widthCache[key];
};

Renderer.prototype.baselineY = function (row) {
  return row * this.cellH + (this.cellH + this.capRatio * this.fontPx) / 2;
};

Renderer.prototype.draw = function (canvasData) {
  var ctx = this.ctx;
  var offset = this.rowOffset;
  var rows = Math.min(canvasData.h, this.rows - offset);
  var cols = Math.min(canvasData.w, this.cols);
  ctx.clearRect(0, 0, this.cols * this.cellW, this.rows * this.cellH);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, this.cols * this.cellW, this.rows * this.cellH);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (var y = 0; y < rows; y++) {
    var cells = canvasData.cells[y];
    var baseline = this.baselineY(y + offset);
    var run = '', runStyle = -1, runX = 0;
    var flush = function (renderer) {
      var self = renderer;
      if (run) {
        self.ctx.fillStyle = MV.COLORS[runStyle];
        self.ctx.font = self.fontFor(MV.BOLD[runStyle]);
        self.ctx.fillText(run, runX * self.cellW, baseline);
        run = '';
      }
    };
    for (var x = 0; x < cols; x++) {
      var ch = cells[x][0], style = cells[x][1];
      if (ch === '' || ch === ' ') { flush(this); continue; }
      if (RECT_GLYPHS[ch] !== undefined || HALF_LEFT[ch] !== undefined) {
        flush(this);
        var x0 = x * this.cellW, w0 = this.cellW;
        var alpha = RECT_GLYPHS[ch];
        if (HALF_LEFT[ch]) { x0 += HALF_LEFT[ch][0] * this.cellW; w0 *= HALF_LEFT[ch][1] - HALF_LEFT[ch][0]; alpha = 1; }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = MV.COLORS[style];
        ctx.fillRect(x0, (y + offset) * this.cellH, w0, this.cellH);
        ctx.globalAlpha = 1;
        continue;
      }
      if (py.cw(ch) === 2) {
        flush(this);
        var width = this.glyphWidth(ch, MV.BOLD[style]);
        var scale = (2 * this.cellW) / width;
        ctx.save();
        ctx.translate(x * this.cellW, baseline);
        ctx.scale(scale, 1);
        ctx.fillStyle = MV.COLORS[style];
        ctx.font = this.fontFor(MV.BOLD[style]);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
        continue;
      }
      if (style !== runStyle) { flush(this); runStyle = style; runX = x; }
      if (!run) runX = x;
      run += ch;
    }
    flush(this);
  }
};

MV.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
