// MV.Canvas - the cell grid, mirrored from player.py's Canvas class.
//
// Contract (parity-critical):
//  - cells[y][x] is a [char, styleIndex] pair; a wide glyph writes the char
//    at x and ['', style] at x+1 ('' is the continuation marker that ansi()
//    and the renderer skip).
//  - put() truncates coordinates via Math.trunc (Python int()), skips
//    combining marks, and writes only when the whole glyph fits.
//  - clip is an inclusive [top, bottom] row range or null.
//  - ansi() emits absolute per-row cursor moves, SGR only when the style
//    changes (kept across rows), and ends with a reset.
(function (root) { 'use strict';
var MV = root.MV || (root.MV = {});
var py = MV.py;

var DIM = 0, NORMAL = 1, BRIGHT = 2, WHITE = 3, RED = 4;

var STYLES = ['\x1b[0;38;5;137m', '\x1b[0;38;5;215m', '\x1b[1;38;5;221m',
              '\x1b[1;38;5;230m', '\x1b[1;38;5;203m', '\x1b[0;38;5;94m',
              '\x1b[0;38;5;58m'];
// xterm-256 -> hex, computed from the SGR indices above (checked by test_web_core).
var COLORS = ['#AF875F', '#FFAF5F', '#FFD75F', '#FFFFD7', '#FF5F5F', '#875F00', '#5F5F00'];
var BOLD = [false, false, true, true, true, false, false];

function Canvas(w, h) {
  if (!(this instanceof Canvas)) return new Canvas(w, h);
  this.w = w; this.h = h;
  this.clip = null;
  this.cells = [];
  for (var y = 0; y < h; y++) {
    var row = [];
    for (var x = 0; x < w; x++) row.push([' ', DIM]);
    this.cells.push(row);
  }
}

Canvas.prototype.put = function (x, y, s, style) {
  if (style === undefined) style = NORMAL;
  x = Math.trunc(x); y = Math.trunc(y);
  if (!(y >= 0 && y < this.h)) return;
  if (this.clip && !(this.clip[0] <= y && y <= this.clip[1])) return;
  s = String(s);
  for (var ch of s) {
    var k = py.cw(ch);
    if (k === 0) continue;
    if (x >= 0 && x + k <= this.w) {
      this.cells[y][x] = [ch, style];
      if (k === 2) this.cells[y][x + 1] = ['', style];
    }
    x += k;
  }
};

Canvas.prototype.center = function (y, s, style) {
  if (style === undefined) style = NORMAL;
  this.put(py.pyfloor(this.w - py.width(s), 2), y, s, style);
};

Canvas.prototype.line = function (x0, y0, x1, y1, ch, style) {
  if (ch === undefined) ch = '.';
  if (style === undefined) style = DIM;
  var steps = Math.max(1, Math.trunc(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 1.5));
  for (var i = 0; i <= steps; i++) {
    var u = i / steps;
    this.put(py.pyRound(x0 + (x1 - x0) * u), py.pyRound(y0 + (y1 - y0) * u), ch, style);
  }
};

Canvas.prototype.box = function (x, y, w, h, style) {
  if (style === undefined) style = DIM;
  if (w < 2 || h < 2) return;
  var rule = '+' + py.pyRepeat('-', w - 2) + '+';
  this.put(x, y, rule, style);
  this.put(x, y + h - 1, rule, style);
  for (var yy = y + 1; yy < y + h - 1; yy++) {
    this.put(x, yy, '|', style);
    this.put(x + w - 1, yy, '|', style);
  }
};

Canvas.prototype.big = function (y, text, style) {
  if (style === undefined) style = BRIGHT;
  text = String(text).toUpperCase();
  var total = text.length * 6 - 1;
  if (total > this.w - 6) { this.center(y + 2, text, style); return; }
  var left = py.pyfloor(this.w - total, 2);
  for (var i = 0; i < text.length; i++) {
    var glyph = MV.FONT[text.charAt(i)] || MV.FONT[' '];
    for (var dy = 0; dy < glyph.length; dy++) {
      for (var dx = 0; dx < glyph[dy].length; dx++) {
        if (glyph[dy].charAt(dx) === '1') this.put(left + i * 6 + dx, y + dy, '#', style);
      }
    }
  }
};

Canvas.prototype.ansi = function () {
  var out = ['\x1b[H'];
  var last = null;
  for (var y = 0; y < this.cells.length; y++) {
    out.push('\x1b[' + (y + 1) + ';1H');
    var row = this.cells[y];
    for (var x = 0; x < row.length; x++) {
      var ch = row[x][0];
      if (!ch) continue;
      var style = row[x][1];
      if (style !== last) { out.push(STYLES[style]); last = style; }
      out.push(ch);
    }
  }
  return out.join('') + '\x1b[0m';
};

Canvas.prototype.plain = function () {
  var lines = [];
  for (var y = 0; y < this.cells.length; y++) {
    var line = '';
    for (var x = 0; x < this.cells[y].length; x++) line += this.cells[y][x][0];
    lines.push(line);
  }
  return lines.join('\n');
};

MV.Canvas = Canvas;
MV.STYLES = STYLES;
MV.COLORS = COLORS;
MV.BOLD = BOLD;
MV.DIM = DIM; MV.NORMAL = NORMAL; MV.BRIGHT = BRIGHT; MV.WHITE = WHITE; MV.RED = RED;
})(typeof globalThis !== 'undefined' ? globalThis : this);
