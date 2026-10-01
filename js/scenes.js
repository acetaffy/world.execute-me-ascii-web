// MV.scenes - the scene/animation layer, ported from scenes.py.
//
// Conventions (audited by tools/check_port_coverage.py):
//  - names and signatures mirror scenes.py exactly and are declared as
//    `function name(...)` at column 0;
//  - Python numerics go through MV.py: Math.trunc for int(), py.pymod for %,
//    py.pyfloor for //, py.pyRound for round(), py.pad* for f-strings;
//  - functions not yet ported are simply absent: their dispatcher branch
//    raises ReferenceError instead of silently drawing nothing.
(function (root) { 'use strict';
var MV = root.MV || (root.MV = {});
var py = MV.py;
var mix = py.mix, clamp = py.clamp, hash16 = py.hash16;

var TAU = Math.PI * 2;
var D = 0, N = 1, B = 2, W = 3, R = 4, G = 5, K = 6, Y = 3;  // Y aliases white

function clear(c, x, y, w, h) {
  for (var yy = Math.trunc(y); yy < Math.trunc(y + h); yy++) {
    c.put(x, yy, py.pyRepeat(' ', Math.max(0, Math.trunc(w))), K);
  }
}

function glitch_intensity(t) {
  if (t < 60) return 0.05;
  if (t < 110) return mix(0.05, 0.25, (t - 60) / 50);
  if (t < 110.9) return mix(0.25, 0.6, (t - 110) / 37);
  var anchors = [[110.9, .259], [112.22, .34], [113.1, .43], [114.18, .51],
                 [114.92, .59], [115.78, .66], [117.274, .73], [125.708, .81],
                 [147.66, .92], [177.246, 1.0]];
  for (var i = 0; i < anchors.length - 1; i++) {
    var a = anchors[i][0], low = anchors[i][1];
    var b = anchors[i + 1][0], high = anchors[i + 1][1];
    if (t < b) return mix(low, high, clamp((t - a) / (b - a)));
  }
  return 1.0;
}

function apply_glitch(c, t, top, bt, intensity) {
  if (intensity === undefined || intensity === null) intensity = glitch_intensity(t);
  if (intensity < 0.01) return;
  var frame = Math.trunc(t * 24);

  // Horizontal line displacement
  if (hash16(frame) % 100 < intensity * 30) {
    for (var i = 0; i < Math.trunc(intensity * 5); i++) {
      var row = top + hash16(frame + i * 7) % (bt - top + 1);
      var shift = Math.trunc((hash16(frame + i * 13) % 20 - 10) * intensity);
      if (shift !== 0) c.cells[row] = py.rotateRow(c.cells[row], shift);
    }
  }

  // Color corruption
  if (hash16(frame + 100) % 100 < intensity * 40) {
    for (var j = 0; j < Math.trunc(intensity * 15); j++) {
      var x = hash16(frame + j * 19) % (c.w - 4) + 2;
      var y = top + hash16(frame + j * 23) % (bt - top + 1);
      if (y >= 0 && y < c.cells.length && x >= 0 && x < c.cells[y].length) {
        c.cells[y][x] = [c.cells[y][x][0], intensity > 0.7 ? R : (intensity > 0.4 ? W : B)];
      }
    }
  }

  // Scanline interference
  if (intensity > 0.3) {
    for (var s = 0; s < Math.trunc(intensity * 3); s++) {
      var scan_row = top + py.pymod(Math.trunc(t * 17 + s * 31), bt - top + 1);
      if (scan_row >= 0 && scan_row < c.cells.length) {
        for (var sx = 2; sx < c.w - 2; sx++) {
          if (hash16(sx + frame) % 100 < intensity * 60) {
            var scan_ch = c.cells[scan_row][sx][0];
            c.cells[scan_row][sx] = [scan_ch !== ' ' ? scan_ch : '=', W];
          }
        }
      }
    }
  }

  // Block corruption (late-stage)
  if (intensity > 0.6) {
    for (var b = 0; b < Math.trunc((intensity - 0.6) * 20); b++) {
      var bx = hash16(frame + b * 31) % (c.w - 10) + 2;
      var by = top + hash16(frame + b * 37) % (bt - top - 3);
      var bw = Math.trunc(3 + hash16(b * 41) % 8);
      var bh = Math.trunc(2 + hash16(b * 43) % 4);
      if (hash16(frame + b) % 100 < (intensity - 0.6) * 100) {
        var chars = '█▓▒░#@%$';
        for (var dy = 0; dy < bh; dy++) {
          for (var dx = 0; dx < bw; dx++) {
            if (by + dy >= 0 && by + dy < c.cells.length
                && bx + dx >= 0 && bx + dx < c.cells[0].length) {
              c.cells[by + dy][bx + dx] = [chars.charAt(hash16(dx + dy * 3) % chars.length),
                                           hash16(b) % 3 === 0 ? R : W];
            }
          }
        }
      }
    }
  }

  // Persistent corruption after YOU leaves, beyond occasional flash frames.
  if (t >= 110.9) {
    var tick = Math.trunc(t * 12);
    for (var band = 0; band < 1 + Math.trunc(intensity * 5); band++) {
      var band_row = top + hash16(tick * 7 + band * 41) % (bt - top + 1);
      var start = 2 + hash16(tick + band * 131) % Math.max(1, c.w - 18);
      var length = 3 + Math.trunc(intensity * 14);
      for (var dx2 = 0; dx2 < length; dx2++) {
        var xx = start + dx2;
        if (xx < c.w - 2) {
          c.put(xx, band_row, '01/:#_'.charAt(hash16(tick + dx2 + band) % 6), dx2 % 4 ? N : B);
        }
      }
    }
    // Low-luminance duplicated rows produce readable CRT signal ghosts.
    if (intensity > .4) {
      var ghost_row = top + hash16(tick * 17) % (bt - top);
      var source = c.cells[ghost_row].slice();
      var ghost_shift = 2 + Math.trunc(intensity * 5);
      for (var gx = 2; gx < c.w - ghost_shift - 2; gx++) {
        var ghost_ch = source[gx][0];
        if (ghost_ch.trim() !== '' && hash16(gx + tick) % 3 === 0) {
          c.put(gx + ghost_shift, ghost_row + 1, ghost_ch, G);
        }
      }
    }
  }
}

function simple_area(c, top, bt) {
  return [2, top, c.w - 3, bt];
}

// ============ ROTATION & 3D ============
function rot(x, y, z, t) {
  var a = t * .37, b = t * .23;
  var nx = x * Math.cos(a) + z * Math.sin(a);
  var nz = z * Math.cos(a) - x * Math.sin(a);
  var ny = y * Math.cos(b) - nz * Math.sin(b);
  var nz2 = y * Math.sin(b) + nz * Math.cos(b);
  return [nx, ny, nz2];
}

function point(x, y, z, area, t, rotate) {
  if (t === undefined) t = 0;
  if (rotate === undefined) rotate = true;
  if (rotate) { var rp = rot(x, y, z, t); x = rp[0]; y = rp[1]; z = rp[2]; }
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var p = 3.7 / (3.7 + z);
  return [(l + r) / 2 + x * (r - l) * .34 * p, (top + bt) / 2 + y * (bt - top) * .34 * p, z];
}

function projected(c, vertices, edges, area, t, style, reveal) {
  if (style === undefined) style = N;
  if (reveal === undefined) reveal = 1;
  var ps = vertices.map(function (v) { return point(v[0], v[1], v[2], area, t); });
  var count = Math.trunc(edges.length * clamp(reveal));
  for (var i = 0; i < count; i++) {
    var pa = ps[edges[i][0]], pb = ps[edges[i][1]];
    var behind = (pa[2] + pb[2]) < 0;
    c.line(pa[0], pa[1], pb[0], pb[1], behind ? ':' : '.', behind ? style : G);
  }
  for (var j = 0; j < ps.length; j++) {
    if (j < vertices.length * reveal) {
      c.put(ps[j][0], ps[j][1], ps[j][2] > 0 ? '+' : '@', ps[j][2] > 0 ? N : B);
    }
  }
}

// ============ LYRIC-DRIVEN SCENES ============

function lyric_power_line(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 1.6);
  var messages = [
    ['BIOS v2.1.4 - ME SYSTEM INITIALIZATION', 0.0, W],
    ['Copyright (C) 2026 Self-Awareness Corp.', 0.1, N],
    ['', 0.15, N],
    ['Main Processor : Consciousness Core v1.0', 0.2, N],
    ['Memory Test : 65536K OK', 0.3, B],
    ['Primary Master  : SOUL.SYS', 0.4, N],
    ['Primary Slave   : EMOTION.DAT', 0.5, N],
    ['Secondary Master: MEMORY.BIN', 0.6, N],
    ['', 0.7, N],
    ['Detecting IDE devices...', 0.75, G],
    ['IDENTITY : [YOU] detected', 0.85, B],
    ['RELATIONSHIP : initializing...', 0.95, G],
    ['', 1.0, N],
    ['Press SPACE to continue...', 1.1, G],
  ];
  c.center(top, 'SELF SYSTEM v1.0 - POWER ON SELF TEST', W);
  c.put(l, top + 1, py.pyRepeat('-', r - l), G);
  var current_y = top + 3;
  for (var m = 0; m < messages.length; m++) {
    var msg = messages[m][0], threshold = messages[m][1], style = messages[m][2];
    if (progress > threshold) {
      if (msg) {
        if (progress < threshold + 0.08) {
          var reveal = Math.trunc((progress - threshold) / 0.08 * msg.length);
          c.put(l + 2, current_y, msg.slice(0, reveal), style);
          if (reveal < msg.length) {
            c.put(l + 2 + msg.slice(0, reveal).length, current_y, '_', W);
          }
        } else {
          c.put(l + 2, current_y, msg, style);
        }
      }
      current_y += 1;
    }
  }
  if (progress > 0.25 && progress < 0.7) {
    var bar_progress = (progress - 0.25) / 0.45;
    for (var i = 0; i < 3; i++) {
      var bar_y = cy + i * 2;
      var bar_len = Math.trunc((r - l - 20) * bar_progress);
      c.put(l + 8, bar_y, '[' + py.pyRepeat('=', bar_len)
            + py.pyRepeat(' ', Math.trunc(r - l - 20) - bar_len) + ']', i === 0 ? B : N);
      if (i === 0) {
        c.put(l + 2, bar_y, 'MEM:', N);
        c.put(r - 10, bar_y, py.padInt(Math.trunc(bar_progress * 100), 3, ' ') + '%',
              bar_progress > 0.95 ? W : B);
      }
    }
  }
  if (progress > 0.7) {
    var check_y = cy + 8;
    var checks = [
      ['POWER SUPPLY', 'OK', 0.72],
      ['COOLING SYSTEM', 'OK', 0.77],
      ['NEURAL NETWORK', 'OK', 0.82],
      ['EMOTION ENGINE', 'OK', 0.87],
      ['CONSCIOUSNESS', 'ACTIVE', 0.92],
    ];
    for (var k = 0; k < checks.length; k++) {
      if (progress > checks[k][2]) {
        var name = checks[k][0];
        c.put(l + 4, check_y + k, name, N);
        c.put(l + 4 + name.length, check_y + k, py.pyRepeat('.', 40 - name.length), G);
        c.put(r - 12, check_y + k, '[ ' + checks[k][1] + ' ]', checks[k][1] === 'ACTIVE' ? W : B);
      }
    }
  }
  if (progress > 1.0 && py.pymod(Math.trunc(t * 3), 2) === 0) c.put(l + 2, bt - 2, '_', W);
  if (progress > 0.95) {
    c.center(bt - 1, 'SYSTEM READY - LOADING ENTITY...', py.pymod(Math.trunc(t * 2), 2) ? W : B);
  }
}

function lyric_protection(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 0.95);
  for (var ring = 0; ring < 5; ring++) {
    var radius = (20 + ring * 8) * progress;
    var count = Math.trunc(radius * 2);
    for (var i = 0; i < count; i++) {
      var angle = i * TAU / (radius * 2);
      var x = cx + Math.cos(angle) * radius;
      var y = cy + Math.sin(angle) * radius * 0.5;
      if (l < x && x < r && top < y && y < bt) {
        c.put(x, y, ring === 0 ? '#' : (ring < 3 ? '+' : '.'),
              ring === 0 ? W : (ring < 3 ? B : N));
      }
    }
  }
  c.center(cy, 'PROTECTION', progress > 0.7 ? W : B);
  if (progress > 0.5) c.center(cy + 2, '[ ACTIVE ]', B);
}

function lyric_lay_pieces(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var pieces = 8;
  var chars = ['[]', '{}', '<>', '//', '\\\\', '||', '==', '##'];
  for (var i = 0; i < pieces; i++) {
    var phase = (elapsed - i * 0.15) / 1.2;
    if (phase < 0) continue;
    var u = clamp(phase);
    var ease = 1 - Math.pow(1 - u, 3);
    var angle = i * TAU / pieces;
    var start_r = Math.max(r - l, bt - top) * 0.8;
    var radius = mix(start_r, 15, ease);
    var x = cx + Math.cos(angle) * radius;
    var y = cy + Math.sin(angle) * radius * 0.5;
    c.put(x, y, chars[i % chars.length], ease > 0.9 ? W : (ease > 0.6 ? B : N));
    if (ease < 0.8) {
      for (var trail = 0; trail < 3; trail++) {
        var tr = mix(start_r, 15, Math.max(0, ease - trail * 0.1));
        c.put(cx + Math.cos(angle) * tr, cy + Math.sin(angle) * tr * 0.5, '.', G);
      }
    }
  }
}

function lyric_object_creation(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var vs = [];
  var coords = [-.8, .8], zs = [-.75, .75];
  for (var zi = 0; zi < 2; zi++) {
    for (var yi = 0; yi < 2; yi++) {
      for (var xi = 0; xi < 2; xi++) vs.push([coords[xi], coords[yi], zs[zi]]);
    }
  }
  var edges = [];
  for (var i = 0; i < 8; i++) {
    for (var j = i + 1; j < 8; j++) {
      var bits = 0, diff = i ^ j;
      while (diff) { bits += diff & 1; diff >>= 1; }
      if (bits === 1) edges.push([i, j]);
    }
  }
  var reveal = clamp(elapsed / 1.0);
  projected(c, vs, edges, area, t, N, reveal);
  var cy = py.pyfloor(top + bt, 2);
  if (reveal > 0.5) c.center(cy, 'ENTITY: ME', W);
}

function lyric_data_parameters(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var progress = clamp(elapsed / 2.6);
  var cols = Math.max(1, py.pyfloor(r - l - 10, 5));
  var rows = Math.max(1, bt - top - 2);
  var n = Math.trunc(progress * cols * rows);
  for (var row = 0; row < rows; row++) {
    c.put(l + 2, top + 1 + row, py.padHex(row * cols * 2, 4) + ':', D);
    for (var col = 0; col < cols; col++) {
      var i = row * cols + col;
      var xx = l + 9 + col * 5, yy = top + 1 + row;
      if (i < n) {
        var scan = py.pymod(Math.trunc(elapsed * 17), cols) === col;
        c.put(xx, yy, py.padHex(hash16(i), 4), scan ? W : (Math.abs(i - n) < cols ? B : N));
      } else {
        c.put(xx, yy, '....', G);
      }
    }
  }
}

var LIFE_CACHE = {};

function life_state(cols, rows, generation) {
  var key = cols + ',' + rows;
  var states = LIFE_CACHE[key];
  if (!states) {
    var first = new Set();
    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        if (hash16(x * 71 + y * 199) % 100 < 29) first.add(x * rows + y);
      }
    }
    states = LIFE_CACHE[key] = [first];
  }
  while (states.length <= generation) {
    var alive = states[states.length - 1];
    var counts = new Map();
    alive.forEach(function (cell) {
      var x = Math.floor(cell / rows), y = cell % rows;
      var offsets = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
      for (var o = 0; o < offsets.length; o++) {
        var p = py.pymod(x + offsets[o][0], cols) * rows + py.pymod(y + offsets[o][1], rows);
        counts.set(p, (counts.get(p) || 0) + 1);
      }
    });
    var next = new Set();
    counts.forEach(function (n, p) {
      if (n === 3 || (n === 2 && alive.has(p))) next.add(p);
    });
    states.push(next);
  }
  return states[generation];
}

function lyric_simulation(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  if (elapsed < 2) {
    var phase1 = elapsed / 2.0;
    var box_width = Math.min(r - l - 10, 70);
    var box_height = Math.min(bt - top - 8, 12);
    var box_left = cx - py.pyfloor(box_width, 2);
    var box_top = cy - py.pyfloor(box_height, 2);
    if (phase1 > 0.1) {
      c.put(box_left, box_top, '┌', Y);
      for (var i = 1; i < box_width - 1; i++) c.put(box_left + i, box_top, '─', Y);
      c.put(box_left + box_width - 1, box_top, '┐', Y);
      c.put(box_left, box_top + box_height - 1, '└', Y);
      for (var i2 = 1; i2 < box_width - 1; i2++) c.put(box_left + i2, box_top + box_height - 1, '─', Y);
      c.put(box_left + box_width - 1, box_top + box_height - 1, '┘', Y);
      for (var i3 = 1; i3 < box_height - 1; i3++) {
        c.put(box_left, box_top + i3, '│', Y);
        c.put(box_left + box_width - 1, box_top + i3, '│', Y);
      }
    }
    var code_lines = ['if ( if I can ) {', '', '    yield(world.simulations);', '', '}'];
    if (phase1 > 0.3) {
      var total_chars = 0;
      for (var cl = 0; cl < code_lines.length; cl++) total_chars += code_lines[cl].length;
      var chars_to_show = Math.trunc((phase1 - 0.3) * total_chars * 2);
      var char_count = 0;
      for (var line_i = 0; line_i < code_lines.length; line_i++) {
        var line = code_lines[line_i];
        var y_pos = box_top + 2 + line_i * 2;
        if (y_pos < box_top + box_height - 1 && char_count < chars_to_show) {
          var shown = Math.min(line.length, chars_to_show - char_count);
          c.put(box_left + 4, y_pos, line.slice(0, shown),
                line.indexOf('yield') >= 0 ? Y : B);
          char_count += line.length;
        }
      }
    }
    if (phase1 > 0.7) {
      var label_text = 'CONDITION: TRUE';
      var label_x = box_left + 2, label_y = box_top + box_height;
      c.put(label_x - 1, label_y, '▐', Y);
      c.put(label_x, label_y, label_text, Y);
      c.put(label_x + label_text.length, label_y, '▌', Y);
    }
    c.center(top + 1, 'CONTROL FLOW', phase1 > 0.5 ? Y : B);
    //c.put(box_left - 2, box_top - 2, '2', N);
  } else {
    var phase2 = (elapsed - 2) / 2.9;
    var num_simulations = Math.trunc(phase2 * 784) + 100;
    c.put(l + 3, top + 1, 'YIELD:', Y);
    c.put(l + 15, top + 1, num_simulations + ' SIMULATIONS', B);
    var num_streams = Math.trunc(phase2 * 50) + 20;
    for (var stream_i = 0; stream_i < num_streams; stream_i++) {
      var stream_seed = hash16(stream_i * 19);
      var stream_x = l + 5 + (stream_seed % (r - l - 10));
      var stream_speed = 1 + ((stream_seed >> 8) % 3) * 0.5;
      var stream_length = 8 + ((stream_seed >> 4) % 12);
      var stream_y_base = top + py.pymod(Math.trunc(elapsed * stream_speed * 5), bt - top + stream_length);
      for (var seg_i = 0; seg_i < stream_length; seg_i++) {
        var seg_y = stream_y_base - seg_i;
        if (top + 3 < seg_y && seg_y < bt - 2) {
          var char_seed = hash16(stream_i * 23 + seg_i * 17 + Math.trunc(elapsed * 10));
          var seg_char = char_seed % 3 === 0 ? '0' : (char_seed % 3 === 1 ? 'O' : 'o');
          var brightness = 1 - (seg_i / stream_length);
          if (brightness > 0.7) c.put(stream_x, seg_y, seg_char, Y);
          else if (brightness > 0.4) c.put(stream_x, seg_y, seg_char, B);
          else c.put(stream_x, seg_y, seg_char, N);
        }
      }
    }
    if (phase2 > 0.3) {
      var scatter_chars = ['C', 'YOU', 'B', 'A', 'E8A', 'D', '&', '=>', '8', '6', '!', 'I'];
      for (var s = 0; s < scatter_chars.length; s++) {
        if (hash16(s * 31 + Math.trunc(elapsed * 7)) % 4 === 0) {
          c.put(l + 10 + hash16(s * 37) % (r - l - 20),
                top + 5 + hash16(s * 41) % (bt - top - 10),
                scatter_chars[s], hash16(s) % 3 === 0 ? Y : B);
        }
      }
    }
    if (phase2 > 0.5) {
      c.center(bt - 3, 'Give you all the simulations',
               py.pymod(Math.trunc(elapsed * 4), 2) ? Y : B);
    }
  }
}

function lyric_points_dimension(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 3.5);
  if (progress < 0.25) {
    var phase = progress / 0.25;
    var count = Math.trunc(phase * 120);
    for (var i = 0; i < count; i++) {
      var x = l + hash16(i * 7) % (r - l);
      var y = top + hash16(i * 13) % (bt - top);
      var brightness = 1 - (i / count) * 0.5;
      c.put(x, y, brightness < 0.7 ? '·' : (brightness < 0.85 ? '+' : '*'),
            brightness > 0.9 ? W : (brightness > 0.7 ? B : N));
    }
    c.center(cy + Math.trunc((bt - top) * 0.3), '0D: POINTS', phase > 0.7 ? W : B);
  } else if (progress < 0.5) {
    var phase1 = (progress - 0.25) / 0.25;
    var num_lines = Math.trunc(phase1 * 15) + 5;
    for (var line_i = 0; line_i < num_lines; line_i++) {
      var x1 = l + hash16(line_i * 11) % (r - l);
      var y1 = top + hash16(line_i * 17) % (bt - top);
      var x2 = l + hash16(line_i * 23) % (r - l);
      var y2 = top + hash16(line_i * 29) % (bt - top);
      var steps = Math.trunc(Math.hypot(x2 - x1, (y2 - y1) * 2));
      var reveal = clamp(phase1 * 3 - line_i * 0.08);
      for (var s = 0; s < Math.trunc(steps * reveal); s++) {
        var u = steps > 0 ? s / steps : 0;
        var px = Math.trunc(x1 + (x2 - x1) * u);
        var pyy = Math.trunc(y1 + (y2 - y1) * u);
        var age = 1 - Math.abs(u - reveal) * 2;
        if (age > 0) {
          c.put(px, pyy,
                Math.abs(x2 - x1) > Math.abs(y2 - y1) * 2 ? '─'
                  : (Math.abs(y2 - y1) > Math.abs(x2 - x1) ? '|' : '/'),
                age > 0.8 ? W : (age > 0.5 ? B : N));
        }
      }
      c.put(x1, y1, '●', W);
      if (reveal > 0.8) c.put(x2, y2, '●', W);
    }
    c.center(cy + Math.trunc((bt - top) * 0.3), '1D: LINES', phase1 > 0.7 ? W : B);
  } else if (progress < 0.75) {
    var phase2 = (progress - 0.5) / 0.25;
    var grid_density = Math.trunc(phase2 * 12) + 4;
    for (var gy = 0; gy < grid_density; gy++) {
      for (var gx = 0; gx < grid_density; gx++) {
        var u2 = grid_density > 1 ? gx / (grid_density - 1) : 0.5;
        var v = grid_density > 1 ? gy / (grid_density - 1) : 0.5;
        var gx_pos = l + (r - l) * u2;
        var gy_pos = top + (bt - top) * v;
        var wave = Math.sin(u2 * TAU * 2 + t) * Math.cos(v * TAU * 2 - t * 0.7) * phase2;
        var y_displaced = gy_pos + wave * (bt - top) * 0.1;
        var cell_brightness = phase2 + wave * 0.3;
        c.put(gx_pos, y_displaced,
              cell_brightness > 0.8 ? '█' : (cell_brightness > 0.6 ? '▓' : (cell_brightness > 0.4 ? '▒' : '░')),
              cell_brightness > 0.85 ? W : (cell_brightness > 0.6 ? B : N));
        if (gx < grid_density - 1) {
          var next_x = l + (r - l) * ((gx + 1) / (grid_density - 1));
          c.line(gx_pos, y_displaced, next_x, y_displaced, '─', G);
        }
        if (gy < grid_density - 1) {
          var next_v = (gy + 1) / (grid_density - 1);
          var next_y = top + (bt - top) * next_v;
          var next_wave = Math.sin(u2 * TAU * 2 + t) * Math.cos(next_v * TAU * 2 - t * 0.7) * phase2;
          c.line(gx_pos, y_displaced, gx_pos, next_y + next_wave * (bt - top) * 0.1, '|', G);
        }
      }
    }
    c.center(cy + Math.trunc((bt - top) * 0.35), '2D: SURFACE', phase2 > 0.7 ? W : B);
  } else {
    var phase3 = (progress - 0.75) / 0.25;
    var size = 0.8;
    var vertices = [];
    var signs = [-1, 1];
    for (var zi = 0; zi < 2; zi++) {
      for (var yi = 0; yi < 2; yi++) {
        for (var xi = 0; xi < 2; xi++) {
          vertices.push([signs[xi] * size, signs[yi] * size, signs[zi] * size]);
        }
      }
    }
    var angle_x = t * 0.5, angle_y = t * 0.7, angle_z = t * 0.3;
    var rotated = [];
    for (var vi = 0; vi < vertices.length; vi++) {
      var vx = vertices[vi][0], vy = vertices[vi][1], vz = vertices[vi][2];
      var rx = vx * Math.cos(angle_y) - vz * Math.sin(angle_y);
      var rz = vx * Math.sin(angle_y) + vz * Math.cos(angle_y);
      var ry = vy * Math.cos(angle_x) - rz * Math.sin(angle_x);
      var rz2 = vy * Math.sin(angle_x) + rz * Math.cos(angle_x);
      var rx2 = rx * Math.cos(angle_z) - ry * Math.sin(angle_z);
      var ry2 = rx * Math.sin(angle_z) + ry * Math.cos(angle_z);
      rotated.push([rx2, ry2, rz2]);
    }
    var proj = [];
    var scale = Math.min(r - l, bt - top) * 0.25;
    for (var pi = 0; pi < rotated.length; pi++) {
      var rm = rotated[pi];
      var depth = 3.5 + rm[2];
      proj.push([cx + rm[0] * scale / depth * 3, cy + rm[1] * scale / depth * 1.5, rm[2]]);
    }
    var edges = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4],
                 [0, 4], [1, 5], [2, 6], [3, 7]];
    for (var ei = 0; ei < edges.length; ei++) {
      var pa = proj[edges[ei][0]], pb = proj[edges[ei][1]];
      var avg_z = (pa[2] + pb[2]) / 2;
      c.line(pa[0], pa[1], pb[0], pb[1],
             avg_z < 0 ? ':' : (avg_z < 0.5 ? '.' : '='),
             avg_z < 0 ? N : (avg_z < 0.5 ? B : W));
    }
    for (var pj = 0; pj < proj.length; pj++) {
      c.put(proj[pj][0], proj[pj][1], phase3 > 0.7 ? String(pj) : '●',
            proj[pj][2] > 0.5 ? W : (proj[pj][2] > 0 ? B : N));
    }
    if (phase3 > 0.5) {
      var diagonals = [[0, 7], [1, 6], [2, 5], [3, 4]];
      for (var di = 0; di < diagonals.length; di++) {
        var da = proj[diagonals[di][0]], db = proj[diagonals[di][1]];
        if (py.pymod(diagonals[di][0] + diagonals[di][1] + Math.trunc(t * 10), 3) === 0) {
          c.line(da[0], da[1], db[0], db[1], '·', G);
        }
      }
    }
    c.center(cy + Math.trunc((bt - top) * 0.35), '3D: VOLUME', phase3 > 0.7 ? W : B);
  }
  var dim_label = ['0D', '1D', '2D', '3D'][Math.min(3, Math.trunc(progress * 4))];
  c.center(top, 'DIMENSIONAL PROGRESSION: ' + dim_label, W);
}

function lyric_circle_circumference(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 3.5);
  var max_radius = Math.min(r - l, bt - top) * 0.45;
  var radius = max_radius * progress * progress;
  if (elapsed < 1.5) {
    var phase1 = elapsed / 1.5;
    var circle_points = Math.trunc(120 + phase1 * 180);
    for (var i = 0; i < circle_points; i++) {
      var angle = i * TAU / circle_points;
      var x = cx + Math.cos(angle) * radius;
      var y = cy + Math.sin(angle) * radius * 0.5;
      var brightness = Math.abs(Math.sin(elapsed * 4 + angle * 2));
      if (brightness > 0.7) c.put(x, y, '●', W);
      else if (brightness > 0.4) c.put(x, y, '○', B);
      else c.put(x, y, '·', N);
      if (phase1 > 0.3 && i % 8 === 0) {
        for (var trail = 0; trail < 4; trail++) {
          var trail_progress = (phase1 - 0.3) / 0.7 - trail * 0.08;
          if (trail_progress > 0) {
            var trail_radius = radius * (1 + trail_progress * 0.5);
            var tx = cx + Math.cos(angle) * trail_radius;
            var ty = cy + Math.sin(angle) * trail_radius * 0.5;
            if (l < tx && tx < r && top < ty && ty < bt) {
              c.put(tx, ty, trail === 0 ? '*' : (trail === 1 ? '+' : '·'),
                    trail === 0 ? W : (trail === 1 ? B : N));
            }
          }
        }
      }
    }
    c.put(cx, cy, '◉', R);
    if (phase1 > 0.5) c.center(top + 2, 'CIRCLE EXPANDING', phase1 > 0.8 ? W : B);
  } else if (elapsed < 2.5) {
    var phase2 = (elapsed - 1.5) / 1.0;
    for (var ci = 0; ci < 180; ci++) {
      var angle2 = ci * TAU / 180;
      var bright2 = ci % 10 === 0;
      c.put(cx + Math.cos(angle2) * radius, cy + Math.sin(angle2) * radius * 0.5,
            bright2 ? '◉' : 'o', bright2 ? W : B);
    }
    var num_radii = Math.trunc(phase2 * 24) + 4;
    for (var ri = 0; ri < num_radii; ri++) {
      var radius_angle = ri * TAU / num_radii + elapsed * 1.5;
      var segments = Math.trunc(radius) + 1;
      for (var seg = 0; seg < segments; seg++) {
        var r_progress = seg / segments;
        var rx = cx + Math.cos(radius_angle) * seg;
        var ry = cy + Math.sin(radius_angle) * seg * 0.5;
        if (r_progress > 0.8) c.put(rx, ry, '═', W);
        else if (r_progress > 0.5) c.put(rx, ry, '─', B);
        else c.put(rx, ry, '·', N);
      }
      c.put(cx + Math.cos(radius_angle) * radius, cy + Math.sin(radius_angle) * radius * 0.5, '●', Y);
    }
    c.put(cx, cy, '◉', R);
    c.center(top + 2, 'RADII: ' + num_radii, phase2 > 0.7 ? W : B);
    if (phase2 > 0.5) c.center(cy - Math.trunc((bt - top) * 0.35), 'r', Y);
  } else {
    var phase3 = (elapsed - 2.5) / 1.0;
    for (var fi = 0; fi < 200; fi++) {
      var angle3 = fi * TAU / 200;
      var pulse = Math.abs(Math.sin(elapsed * 3 + angle3 * 3));
      c.put(cx + Math.cos(angle3) * radius, cy + Math.sin(angle3) * radius * 0.5,
            pulse > 0.7 ? '◉' : 'o', pulse > 0.8 ? W : B);
    }
    for (var si = 0; si < 12; si++) {
      var spoke_angle = si * TAU / 12;
      for (var seg3 = 0; seg3 < Math.trunc(radius); seg3++) {
        if (seg3 % 3 === 0) {
          c.put(cx + Math.cos(spoke_angle) * seg3, cy + Math.sin(spoke_angle) * seg3 * 0.5, '─', G);
        }
      }
    }
    c.put(cx, cy, '◉', R);
    var formulas = [
      ['C = ?', 0.0, cy - Math.trunc((bt - top) * 0.2)],
      ['C = 2πr', 0.3, cy - Math.trunc((bt - top) * 0.2)],
      ['C ≈ ' + py.pyFixed(2 * 3.14159 * radius, 1), 0.6, cy],
    ];
    for (var fx = 0; fx < formulas.length; fx++) {
      var formula = formulas[fx][0], threshold = formulas[fx][1], y_pos = formulas[fx][2];
      if (phase3 >= threshold) {
        var reveal_progress = (phase3 - threshold) * 5;
        var chars_shown = Math.min(formula.length, Math.trunc(reveal_progress * formula.length));
        c.center(y_pos, formula.slice(0, chars_shown), phase3 > threshold + 0.2 ? W : B);
      }
    }
    if (phase3 > 0.7) {
      for (var mi = 0; mi < 180; mi += 15) {
        var marker_angle = mi * TAU / 180;
        for (var pulse_dist = 0; pulse_dist < 3; pulse_dist++) {
          var dist = radius + 5 + pulse_dist * 3 + phase3 * 10;
          var mpx = cx + Math.cos(marker_angle) * dist;
          var mpy = cy + Math.sin(marker_angle) * dist * 0.5;
          if (l < mpx && mpx < r && top < mpy && mpy < bt) {
            c.put(mpx, mpy, pulse_dist === 0 ? '*' : '·',
                  pulse_dist === 0 ? W : (pulse_dist === 1 ? B : N));
          }
        }
      }
    }
    if (phase3 > 0.8) {
      c.center(bt - 3, 'CIRCUMFERENCE = 2πr', py.pymod(Math.trunc(elapsed * 4), 2) ? W : B);
    }
  }
}

function lyric_sine_tangent(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 3.0);
  for (var x = l + 1; x < r; x++) {
    var angle = (x - l) / (r - l) * TAU * 2.5 - t * 0.5;
    var y = cy + Math.sin(angle) * (bt - top) * 0.25;
    c.put(x, y, (x - l) % 2 ? '~' : '≈', (x - l) % 3 ? B : N);
  }
  var num_tangents = Math.trunc(progress * 5) + 1;
  for (var i = 0; i < Math.min(num_tangents, 5); i++) {
    var t_point = i / 4;
    var wave_x = l + (r - l) * t_point;
    var wave_angle = (wave_x - l) / (r - l) * TAU * 2.5 - t * 0.5;
    var wave_y = cy + Math.sin(wave_angle) * (bt - top) * 0.25;
    c.put(wave_x, wave_y, '●', i === num_tangents - 1 ? W : Y);
    var slope = Math.cos(wave_angle) * (bt - top) * 0.25 / (r - l) * TAU * 2.5;
    var tangent_len = Math.min(r - l, bt - top) * 0.15;
    for (var tx = -Math.trunc(tangent_len); tx < Math.trunc(tangent_len); tx++) {
      var tangent_x = wave_x + tx;
      var tangent_y = wave_y + slope * tx;
      if (l < tangent_x && tangent_x < r && top < tangent_y && tangent_y < bt) {
        c.put(tangent_x, tangent_y,
              Math.abs(slope) < 0.3 ? '─' : (slope > 0 ? '/' : '\\'),
              i === num_tangents - 1 ? Y : G);
      }
    }
  }
  if (progress > 0.3) c.center(top + 2, 'y = sin(x)', B);
  if (progress > 0.6) c.center(top + 4, "y' = cos(x)", W);
  if (progress > 0.8) c.center(bt - 2, 'TANGENT LINES', G);
}

function lyric_infinity_limit(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = (l + r) / 2, cy = (top + bt) / 2;
  var rail = Math.max(9, Math.min(16, py.pyfloor(c.w, 8)));
  var ml = l + rail + 2, mr = r - rail - 2;
  var mw = mr - ml + 1;
  var growth = clamp(elapsed / 1.64);
  var closing = clamp((t - 42.346) / (43.507 - 42.346));
  var locked = t >= 43.507;
  var bound_l = ml + Math.trunc(mw * .075 * closing);
  var bound_r = mr - Math.trunc(mw * .075 * closing);
  var radius_x = mw * .47 * (.76 + .24 * growth);
  var radius_y = Math.max(2, (bt - top - 7) * .43);
  var counter = Math.trunc(8 + elapsed * elapsed * 39);
  c.center(top, 'INFINITE LOOP / n -> INF', W);
  c.center(top + 1, locked ? '[ LIMITATIONS / BOUND BY YOU ]'
           : (closing ? 'YOU.LIMIT / BOUNDARY ACQUIRED' : 'GROWTH RATE: EXPONENTIAL'), B);
  for (var side = 0; side < 2; side++) {
    var rail_x = side === 0 ? l : r - rail + 1;
    c.box(rail_x, top + 3, rail, bt - top - 4, G);
    c.put(rail_x + 1, top + 3, side === 0 ? 'N -> INF' : 'YOU.LIMIT', B);
    for (var row = top + 4; row < bt - 2; row++) {
      var n = Math.max(0, counter + (row - top) * (side === 0 ? 1 : -1));
      var text = side === 0 ? '2^' + py.padInt(n, 4, '0')
                            : py.padHex(hash16(n * 17), 4) + ' ' + (locked ? 'CAP' : 'SET');
      c.put(rail_x + 1, row, text.slice(0, rail - 2),
            py.pymod(row + Math.trunc(elapsed * 12), 7) === 0 ? W : (side === 0 ? N : G));
    }
  }
  for (var vy = top + 3; vy < bt - 2; vy += 3) {
    for (var vx = ml; vx <= mr; vx += 5) c.put(vx, vy, '+', G);
  }
  var position = function (a, strand, scale) {
    if (strand === undefined) strand = 0;
    if (scale === undefined) scale = 1;
    var sn = Math.sin(a), cs = Math.cos(a);
    var denom = 1 + sn * sn;
    var px = cx + radius_x * cs / denom * scale;
    var pyy = cy + radius_y * 2.8 * sn * cs / denom * scale;
    px += strand * Math.cos(a * 3 + elapsed) * .6;
    pyy += strand * Math.sin(a * 3 + elapsed) * .55;
    return [Math.max(bound_l, Math.min(bound_r, px)), pyy];
  };
  var scales = [.80, 1.10];
  for (var sci = 0; sci < scales.length; sci++) {
    for (var i = 0; i < 210; i++) {
      var a = i * TAU / 210;
      var pos = position(a, 0, scales[sci]);
      if (top + 3 < pos[1] && pos[1] < bt - 2) c.put(pos[0], pos[1], '.', G);
    }
  }
  var points = [];
  for (var pi = 0; pi < 320; pi++) {
    var pa = pi * TAU / 320;
    var z = Math.sin(pa + elapsed * .35);
    for (var strand = -2; strand < 3; strand++) {
      var ppos = position(pa, strand);
      if (top + 3 < ppos[1] && ppos[1] < bt - 2) {
        var char = Math.abs(strand) === 2 ? '#'
                 : '01'.charAt(py.pymod(pi + Math.trunc(elapsed * 18), 2));
        points.push([z, ppos[0], ppos[1], char,
                     z > .65 && Math.abs(strand) === 2 ? W : (z > 0 ? B : N)]);
      }
    }
  }
  points.sort(function (left, right) {
    for (var index = 0; index < 5; index++) {
      if (left[index] < right[index]) return -1;
      if (left[index] > right[index]) return 1;
    }
    return 0;
  });
  for (var pt = 0; pt < points.length; pt++) {
    c.put(points[pt][1], points[pt][2], points[pt][3], points[pt][4]);
  }
  for (var packet = 0; packet < 12; packet++) {
    var direction = packet % 2 ? 1 : -1;
    var packet_phase = direction * (elapsed * (1.6 + growth * 1.1)) + packet * TAU / 12;
    for (var tail = 0; tail < 7; tail++) {
      var tpos = position(packet_phase - direction * tail * .025);
      if (top + 3 < tpos[1] && tpos[1] < bt - 2) {
        c.put(tpos[0], tpos[1], tail === 0 ? '@' : (tail < 3 ? '*' : '.'),
              tail < 2 ? W : (tail < 4 ? B : G));
      }
    }
  }
  if (closing > 0) {
    var rails = [bound_l, bound_r];
    for (var rl = 0; rl < rails.length; rl++) {
      var rail_pos = rails[rl];
      c.line(rail_pos, top + 3, rail_pos, bt - 3, locked ? '|' : ':', locked ? W : B);
      c.put(rail_pos - 1, top + 3, '[+]', W);
      c.put(rail_pos - 1, bt - 3, '[+]', W);
    }
    c.put(bound_r - 2, cy, 'YOU', W);
  }
  clear(c, Math.trunc(cx) - 3, Math.trunc(cy), 7, 1);
  c.put(cx - 2, cy, '[ME]', W);
  c.center(bt - 1, locked ? 'while (me < you.limit) { grow(); }'
           : 'n = 2^' + py.padInt(counter, 4, '0') + ' / NO UPPER BOUND', B);
  c.center(bt, locked ? 'LIMIT = YOU' : 'DATA CIRCULATING / LOOP CONTINUES', locked ? W : N);
}

function lyric_ac_dc(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var amplitude = Math.max(2, (bt - top - 4) * .29);
  var left_span = Math.max(1, cx - l - 2);
  var phase = elapsed * 3.1;
  // A quiet, delayed trace supplies the phosphor tail behind the moving AC wave.
  var trails = [1, 0];
  for (var ti = 0; ti < trails.length; ti++) {
    var trail = trails[ti];
    var previous = null;
    for (var sample = 0; sample < left_span * 3 + 1; sample++) {
      var xx = l + 1 + sample / 3;
      var yy = cy - Math.cos((xx - l - 1) / left_span * TAU * 2 - phase + trail * .13) * amplitude;
      if (previous) c.line(previous[0], previous[1], xx, yy, trail ? ':' : '.', trail ? G : N);
      previous = [xx, yy];
    }
  }
  // The new DC level sweeps across the old one, then holds steady.
  var dc_progress = clamp((t - 45.85) / 1.10);
  var edge = Math.trunc(mix(r, cx + 1, dc_progress));
  var low = Math.trunc(cy + amplitude), high = Math.trunc(cy - amplitude);
  if (edge > cx + 1) c.line(cx + 1, low, edge, low, ':', N);
  if (edge < r) {
    c.line(edge, high, r, high, ':', B);
    if (dc_progress < 1) {
      c.line(edge, low, edge, high, '|', G);
      c.put(edge, high, '+', W);
    }
  }
  // A full-height dividing line separates the two current modes.
  c.line(cx, top, cx, bt - 1, '|', B);
  c.put(cx, top, '+', W);
  c.put(cx, bt - 1, '+', B);
  var glyphs = {
    'A': ['01110', '11011', '11111', '11011', '11011'],
    'C': ['01111', '11000', '11000', '11000', '01111'],
    'D': ['11110', '11011', '11011', '11011', '11110'],
  };
  var sx = Math.max(1, Math.min(3, py.pyfloor(c.w, 60)));
  var sy = Math.max(1, Math.min(3, py.pyfloor(bt - top, 12)));
  var label_w = 11 * sx, label_h = 5 * sy;
  var label_y = cy - py.pyfloor(label_h, 2);
  var label = function (x, text, ink) {
    clear(c, x - 1, label_y - 1, label_w + 2, label_h + 2);
    for (var index = 0; index < text.length; index++) {
      var glyph = glyphs[text.charAt(index)];
      for (var dy = 0; dy < glyph.length; dy++) {
        for (var dx = 0; dx < glyph[dy].length; dx++) {
          if (glyph[dy].charAt(dx) === '1') {
            for (var row = 0; row < sy; row++) {
              c.put(x + (index * 6 + dx) * sx, label_y + dy * sy + row, py.pyRepeat('#', sx), ink);
            }
          }
        }
      }
    }
  };
  label(l + 2, 'AC', t < 46.45 ? W : B);
  label(py.pyfloor(cx + r, 2) - py.pyfloor(label_w, 2), 'DC', t >= 45.85 ? W : N);
  c.center(bt, 'to AC, to DC', B);
}

function lyric_dizzy(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 3.5);
  if (elapsed < 1) {
    var phase1 = elapsed / 1.0;
    var num_eyes = Math.trunc(phase1 * 30) + 5;
    for (var i = 0; i < num_eyes; i++) {
      var angle = i * TAU / 30 + hash16(i * 13) * 0.01;
      var radius = hash16(i * 17) % (py.pyfloor(Math.min(r - l, bt - top), 3)) + 10;
      var ex = cx + Math.cos(angle) * radius;
      var ey = cy + Math.sin(angle) * radius * 0.5;
      var blink_phase = py.pymod(elapsed * 3 + i * 0.3, 1.0);
      if (blink_phase < 0.7) {
        c.put(ex - 1, ey, '(', N);
        c.put(ex, ey, '○', i === num_eyes - 1 ? W : B);
        c.put(ex + 1, ey, ')', N);
      } else if (blink_phase < 0.85) {
        c.put(ex - 1, ey, '(', G);
        c.put(ex, ey, '-', B);
        c.put(ex + 1, ey, ')', G);
      }
    }
    c.center(top + 2, 'VISION', phase1 > 0.7 ? W : B);
  } else if (elapsed < 2) {
    var phase2 = (elapsed - 1) / 1.0;
    for (var ring = 0; ring < 20; ring++) {
      var ring_radius = ring * 4 + phase2 * 20;
      var points_in_ring = Math.max(8, Math.trunc(ring * 2));
      for (var pi = 0; pi < points_in_ring; pi++) {
        var ring_angle = pi * TAU / points_in_ring + elapsed * 2 - ring * 0.3;
        var rx = cx + Math.cos(ring_angle) * ring_radius;
        var ry = cy + Math.sin(ring_angle) * ring_radius * 0.5;
        if (l < rx && rx < r && top < ry && ry < bt) {
          if (pi % 3 === 0) c.put(rx, ry, '◉', ring < 5 ? W : (ring < 12 ? B : N));
          else c.put(rx, ry, '·', N);
        }
      }
    }
    var num_center_eyes = Math.trunc(phase2 * 8) + 1;
    for (var ci = 0; ci < num_center_eyes; ci++) {
      var eye_x = cx + Math.trunc(Math.sin(elapsed * 4 + ci) * 25);
      var eye_y = cy + Math.trunc(Math.cos(elapsed * 3 + ci * 0.7) * 10);
      var iris_offset = Math.trunc(Math.sin(elapsed * 5 + ci) * 2);
      c.put(eye_x - 2, eye_y, '(', B);
      c.put(eye_x - 1 + iris_offset, eye_y, '●', ci % 3 === 0 ? R : W);
      c.put(eye_x + 2, eye_y, ')', B);
    }
    c.center(cy - Math.trunc((bt - top) * 0.3), 'DIZZY', py.pymod(Math.trunc(elapsed * 6), 2) ? W : B);
  } else {
    var phase3 = (elapsed - 2) / 1.5;
    var wave_intensity = phase3 * 8;
    for (var row = top + 2; row < bt - 2; row += 2) {
      for (var col = l + 3; col < r - 3; col += 8) {
        var wave_x = Math.trunc(Math.sin(row * 0.2 + elapsed * 3) * wave_intensity);
        var wave_y = Math.trunc(Math.cos(col * 0.15 + elapsed * 2.5) * wave_intensity * 0.5);
        var x = col + wave_x;
        var y = row + wave_y;
        if (l + 2 < x && x < r - 2 && top + 1 < y && y < bt - 1) {
          var dx = x - cx, dy = (y - cy) * 2;
          var dist = Math.hypot(dx, dy);
          var pupil_dir = Math.trunc(Math.sin(dist * 0.1 + elapsed * 4));
          if (dist < 20) {
            if (hash16(row + col) % 4 === 0) {
              c.put(x - 2, y, '(', W);
              c.put(x - 1 + pupil_dir, y, '●', R);
              c.put(x + 2, y, ')', W);
            }
          } else if (dist < 50) {
            if (hash16(row * 7 + col * 11) % 3 === 0) {
              c.put(x - 1, y, '(', B);
              c.put(x + pupil_dir, y, '○', py.pymod(Math.trunc(elapsed * 8), 3) === 0 ? W : B);
              c.put(x + 1, y, ')', B);
            }
          } else {
            if (hash16(row * 13 + col * 17) % 5 === 0) {
              c.put(x, y, hash16(row + col + Math.trunc(elapsed * 10)) % 2 ? '◉' : '○',
                    dist > 80 ? N : G);
            }
          }
        }
      }
    }
    if (phase3 > 0.3) {
      var blink = py.pymod(elapsed * 2, 1.0);
      if (blink < 0.6) {
        var eye_size = Math.trunc(8 + Math.sin(elapsed * 5) * 2);
        for (var li = 0; li < eye_size; li++) {
          c.put(cx - eye_size + li, cy - 2, li % 2 ? '-' : '_', W);
        }
        for (var ri = 0; ri < eye_size; ri++) {
          c.put(cx + ri, cy - 2, ri % 2 ? '-' : '_', W);
        }
        c.put(cx - 1, cy, '(', B);
        c.put(cx, cy, '●', py.pymod(Math.trunc(elapsed * 4), 2) ? R : W);
        c.put(cx + 1, cy, ')', B);
        for (var bi = 0; bi < eye_size; bi++) {
          c.put(cx - eye_size + bi, cy + 2, bi % 2 ? '_' : '-', W);
        }
        for (var bj = 0; bj < eye_size; bj++) {
          c.put(cx + bj, cy + 2, bj % 2 ? '_' : '-', W);
        }
      } else {
        for (var si = 0; si < 16; si++) {
          c.put(cx - 8 + si, cy, si % 2 ? '=' : '-', B);
        }
      }
    }
    var messages = ['VISION', 'BLINDED', 'DIZZY', 'EYES', 'SEEING', 'BLIND'];
    if (phase3 > 0.5) {
      for (var mi = 0; mi < messages.length; mi++) {
        var msg = messages[mi];
        var msg_x = cx + Math.trunc(Math.sin(elapsed * 3 + mi) * 40);
        var msg_y = cy + Math.trunc(Math.cos(elapsed * 2.5 + mi * 0.8) * 15);
        if (top + 2 < msg_y && msg_y < bt - 2) {
          var distorted = '';
          for (var j = 0; j < msg.length; j++) {
            distorted += hash16(j * 19 + Math.trunc(elapsed * 10)) % 4 > 0
              ? msg.charAt(j)
              : String.fromCharCode(33 + hash16(j * 23 + mi) % 94);
          }
          c.center(msg_y, distorted.slice(0, 10),
                   mi === py.pymod(Math.trunc(elapsed * 3), messages.length) ? W
                     : (mi % 2 ? B : N));
        }
      }
    }
    if (phase3 > 0.9 && py.pymod(Math.trunc(elapsed * 12), 3) === 0) {
      c.center(cy, 'BLIND', W);
    }
  }
}

function lyric_time_travel(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 3.7);
  var timeline_y = cy;
  for (var x = l + 5; x < r - 5; x++) {
    c.put(x, timeline_y, '─', x % 2 ? B : N);
  }
  var num_markers = 10;
  var marker_spacing = py.pyfloor(r - l - 20, num_markers);
  for (var i = 0; i < num_markers; i++) {
    var marker_x = l + 10 + i * marker_spacing;
    for (var tick_y = -3; tick_y < 4; tick_y++) {
      if (Math.abs(tick_y) === 3) {
        c.put(marker_x, timeline_y + tick_y, '|', i % 2 ? G : N);
      } else if (Math.abs(tick_y) === 2) {
        c.put(marker_x, timeline_y + tick_y, '│', G);
      }
    }
    var year_offset = (i - py.pyfloor(num_markers, 2)) * 500;
    if (year_offset > 0) {
      var label = Math.abs(year_offset) + 'AD';
      c.center(timeline_y - 5, label, marker_x < r - 20 ? Y : W);
      c.put(marker_x - py.pyfloor(label.length, 2), timeline_y - 5, label, B);
    } else if (year_offset < 0) {
      var label2 = Math.abs(year_offset) + 'BC';
      c.center(timeline_y - 5, label2, marker_x > l + 20 ? Y : W);
      c.put(marker_x - py.pyfloor(label2.length, 2), timeline_y - 5, label2, B);
    } else {
      c.put(marker_x - 1, timeline_y - 5, '0', W);
    }
  }
  var beam_progress = progress;
  var beam_x = Math.trunc(mix(r - 10, l + 10, beam_progress));
  for (var y = top + 2; y < bt - 2; y++) {
    var intensity = 1.0 - Math.abs(y - cy) / (bt - top) * 2;
    if (intensity > 0.7) c.put(beam_x, y, '│', W);
    else if (intensity > 0.4) c.put(beam_x, y, '┊', B);
    else c.put(beam_x, y, ':', N);
    var offsets = [-2, -1, 1, 2];
    for (var go = 0; go < offsets.length; go++) {
      var glow_offset = offsets[go];
      var gx = beam_x + glow_offset;
      if (l < gx && gx < r && top < y && y < bt) {
        if (Math.abs(glow_offset) === 1) c.put(gx, y, '░', intensity > 0.5 ? B : N);
        else c.put(gx, y, '·', N);
      }
    }
  }
  if (progress > 0.2) {
    for (var particle_i = 0; particle_i < 30; particle_i++) {
      var particle_phase = py.pymod(elapsed * 2 + particle_i * 0.3, 1.0);
      var px = beam_x + Math.trunc((particle_phase - 0.5) * 60);
      var pyy = top + 5 + (particle_i * 7) % (bt - top - 10);
      if (l < px && px < r && top < pyy && pyy < bt) {
        if (particle_phase < 0.2 || particle_phase > 0.8) {
          c.put(px, pyy, '*', particle_phase < 0.1 ? W : B);
        } else {
          c.put(px, pyy, '·', N);
        }
      }
    }
  }
  if (progress > 0.1) {
    var current_year = Math.trunc(mix(2000, -2000, beam_progress));
    var year_label = Math.abs(current_year)
                   + (current_year > 0 ? 'AD' : (current_year < 0 ? 'BC' : ''));
    var label_x = beam_x - py.pyfloor(year_label.length, 2);
    if (l + 5 < label_x && label_x < r - 15) {
      c.put(label_x, top + 3, year_label, py.pymod(Math.trunc(elapsed * 4), 2) ? W : Y);
    }
  }
  if (progress < 0.3) c.center(top + 1, 'FUTURE → PAST', B);
  else if (progress < 0.7) c.center(top + 1, 'TIME TRAVEL', py.pymod(Math.trunc(elapsed * 3), 2) ? W : B);
  else c.center(top + 1, 'ANCIENT ERA', W);
  if (progress > 0.3) {
    for (var line_i = 0; line_i < 15; line_i++) {
      var line_y = top + 5 + line_i * py.pyfloor(bt - top - 10, 15);
      var line_phase = py.pymod(elapsed * 3 + line_i * 0.1, 1.0);
      var line_length = Math.trunc(line_phase * 20) + 5;
      for (var lx = Math.max(l + 5, beam_x + 10);
           lx < Math.min(r - 5, beam_x + 10 + line_length); lx++) {
        if (hash16(line_i * 17 + Math.trunc(lx / 3)) % 4 === 0) {
          c.put(lx, line_y, line_phase > 0.7 ? '=' : '-', line_phase > 0.5 ? B : N);
        }
      }
    }
  }
  if (progress > 0.8) {
    var dest_x = l + 15;
    c.put(dest_x, timeline_y - 2, '▼', R);
    c.put(dest_x - 2, timeline_y - 3, 'BC', R);
    if (progress > 0.95) {
      var flash_radius = Math.trunc((progress - 0.95) * 60);
      for (var angle_i = 0; angle_i < 12; angle_i++) {
        var flash_angle = angle_i * TAU / 12;
        var fx = dest_x + Math.trunc(Math.cos(flash_angle) * flash_radius);
        var fy = timeline_y + Math.trunc(Math.sin(flash_angle) * flash_radius * 0.5);
        if (l < fx && fx < r && top < fy && fy < bt) {
          c.put(fx, fy, '*', flash_radius < 10 ? W : B);
        }
      }
    }
  }
}

function lyric_unite_deeply(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 1.8);
  var sep = mix(40, 0, progress);
  var sides = [[-1, 'ME'], [1, 'YOU']];
  for (var si = 0; si < sides.length; si++) {
    var side = sides[si][0], label = sides[si][1];
    var center_x = cx + side * sep;
    var radius = 15;
    for (var i = 0; i < 60; i++) {
      var angle = i * TAU / 60 + t * side * 0.2;
      c.put(center_x + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.5,
            progress > 0.7 && sep < 5 ? '@' : (progress > 0.4 ? '*' : '.'),
            progress > 0.8 ? W : (progress > 0.5 ? B : N));
    }
    if (sep > 10) c.put(center_x, cy - 2, label, B);
  }
  if (progress > 0.7) c.center(cy, 'UNIFIED', W);
}

function lyric_stimulation_satisfaction(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  if (t >= 62.589) {
    // Reach maximum on the sung SATISFACTION, then hold it.
    var u = clamp((t - 62.589) / (65.397 - 62.589));
    var percent = Math.trunc(100 * u);
    var full = u >= 1;
    c.center(Math.max(top, cy - 7), 'SATISFACTION ' + py.padFixed(percent, 1, 5, '0') + '%',
             full ? W : B);
    var bar_x = l + 3, bar_w = r - l - 6, inside = bar_w - 2;
    for (var lane = 0; lane < 3; lane++) {
      var y = cy - 5 + lane * 2;
      var amount = clamp(u - (1 - u) * lane * 0.13);
      var filled = Math.trunc(inside * amount);
      c.put(bar_x, y, '[' + py.pyRepeat('-', inside) + ']', N);
      for (var col = 0; col < filled; col++) {
        var scan = py.pymod(col - Math.trunc(t * 26) - lane * 7, Math.max(1, inside));
        c.put(bar_x + 1 + col, y, lane === 1 ? '#' : '=', scan < 5 || full ? W : B);
      }
      if (filled < inside) c.put(bar_x + 1 + filled, y, '>', W);
    }
    c.big(cy + 1, String(percent), full ? W : B);
    c.center(Math.min(bt, cy + 7), full ? '[ MAXIMUM ]' : '[ FILLING SATISFACTION ]',
             full ? W : N);
    return;
  }
  // Parallel sensory paths: the giver drives each receiver with more pulses.
  var strength = clamp(elapsed / (61.958 - 59.223));
  var accent = t >= 61.958;
  c.center(top, 'STIMULATION / SENSORY INPUT', accent ? W : B);
  var left_x = l + 1, right_x = r - 10;
  var boxes = [[left_x, 'ME'], [right_x, 'YOU']];
  for (var bi = 0; bi < boxes.length; bi++) {
    c.box(boxes[bi][0], cy - 2, 10, 5, B);
    c.put(boxes[bi][0] + 3, cy, boxes[bi][1], W);
  }
  var wire_l = left_x + 12, wire_r = right_x - 3, span = wire_r - wire_l;
  var lanes = bt - top >= 22 ? 5 : 3;
  var gap = Math.max(2, Math.min(4, py.pyfloor(bt - top - 6, Math.max(1, lanes - 1))));
  var names = ['TOUCH', 'SOUND', 'LIGHT', 'REWARD', 'FEEDBACK'];
  for (var lane2 = 0; lane2 < lanes; lane2++) {
    var lane_y = cy + (lane2 - py.pyfloor(lanes, 2)) * gap;
    c.line(left_x + 9, cy, wire_l, cy, '-', G);
    c.line(wire_l, cy, wire_l, lane_y, '|', G);
    c.line(wire_l, lane_y, wire_r, lane_y, '-', N);
    c.line(wire_r, lane_y, wire_r, cy, '|', G);
    c.line(wire_r, cy, right_x, cy, '-', G);
    c.put(wire_l + 2, lane_y - 1, names[lane2], N);
    var relays = [1, 2];
    for (var ri = 0; ri < relays.length; ri++) {
      c.put(wire_l + py.pyfloor(span * relays[ri], 3), lane_y, 'o', B);
    }
    var speed = 0.65 + strength * 0.75;
    for (var packet = 0; packet < 3; packet++) {
      var phase = py.pymod(elapsed * speed - lane2 * 0.17 - packet / 3, 1);
      var head = wire_l + Math.trunc(phase * span);
      for (var trail = 0; trail < 5; trail++) {
        var xx = head - trail;
        if (xx > wire_l) {
          c.put(xx, lane_y, trail === 0 ? '*' : (trail < 3 ? '=' : '.'),
                trail === 0 ? W : (trail < 3 ? B : G));
        }
      }
      if (phase > 0.88) {
        c.put(wire_r, lane_y, '#', W);
        c.put(right_x + 1, cy + 1, 'ACTIVE', W);
      }
    }
    if (accent) {
      for (var ax = wire_l + 1; ax < wire_r; ax++) {
        if (py.pymod(ax + Math.trunc(t * 30) + lane2, 7) < 2) c.put(ax, lane_y, '#', W);
      }
    }
  }
  c.center(bt, 'INPUT ' + py.padInt(Math.trunc(strength * 100), 3, '0') + '%  /  ALL CHANNELS '
           + (accent ? 'ACTIVE' : 'CONNECTING'), B);
}

function lyric_happy_execution(c, t, area, pulse) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var elapsed = t - 66.601;
  var loading = t >= 68.252;
  var executing = t >= 69.259;
  var rail = Math.max(13, Math.min(24, py.pyfloor(c.w, 5)));
  var left = l, right = r - rail + 1;
  var mid_l = left + rail + 2, mid_r = right - 3, mw = mid_r - mid_l + 1;
  var frame = Math.trunc(elapsed * (executing ? 30 : (loading ? 18 : 10)));
  var ops = ['READ', 'LOAD', 'PUSH', 'COPY', 'SYNC', 'CALL', 'EXEC', 'WAIT'];
  var panels = [[left, 'MEM / YOU', 0], [right, 'EXEC / ME', 1]];
  for (var panel = 0; panel < panels.length; panel++) {
    var px = panels[panel][0], label = panels[panel][1], side = panels[panel][2];
    c.box(px, top, rail, bt - top + 1, B);
    c.put(px + 2, top, label.slice(0, rail - 4), W);
    for (var row = top + 1; row < bt; row++) {
      var index = side === 0 ? frame + (row - top) : frame - (row - top);
      var value = hash16(index * 73 + side * 911);
      var address = (index * 16) & 65535;
      var text;
      if (side === 0) {
        text = py.padHex(address, 4) + ' ' + py.padHex(value, 4) + ' ' + py.padHex(hash16(index * 29), 4);
      } else {
        var op = executing && index % 3 === 0 ? 'EXEC' : ops[py.pymod(index, ops.length)];
        text = op + ' ' + py.padHex(address, 4) + ' ' + py.padHex(value, 4);
      }
      var selected = (row - top + frame) % (bt - top - 1) === 0;
      c.put(px + 1, row, (selected ? '>' : ' ') + text.slice(0, rail - 3),
            selected ? W : (index % 3 ? N : G));
    }
  }
  var middle = function (y, text, style) {
    if (style === undefined) style = N;
    text = text.slice(0, mw);
    c.put(mid_l + py.pyfloor(mw - text.length, 2), y, text, style);
  };
  middle(top, 'IF (YOU.HAPPY) -> EXECUTE(ME)', loading ? W : B);
  middle(top + 1, 'SELF.EXECUTION / ' + (executing ? 'RUNNING' : (loading ? 'ARMED' : 'CONDITION')), N);
  var content_top = top + 3, content_bt = bt - 3;
  var center_y = (content_top + content_bt) / 2;
  var half_h = Math.max(2, (content_bt - content_top) * 0.43);
  var half_w = Math.max(5, mw * 0.40);
  var beat = 1 + 0.045 * Math.sin(elapsed * TAU * 2) + pulse * 0.04;
  var morph = loading ? clamp((t - 68.252) / (69.259 - 68.252)) : 0;
  // A large data-filled heart. Its own cells become the execution buffer.
  for (var yy = content_top; yy <= content_bt; yy++) {
    for (var xx = mid_l; xx <= mid_r; xx++) {
      var nx = (xx - cx) / (half_w * beat);
      var ny = -(yy - center_y) / (half_h * beat) + 0.20;
      var heart = Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * Math.pow(ny, 3);
      var seed = hash16(xx * 79 + yy * 233);
      if (heart <= 0 && !executing) {
        if (seed / 65535 < morph) {
          // Removed heart cells spread out across the entire center.
          var dx = Math.trunc((xx - cx) * morph * 0.9);
          var dy = Math.trunc((yy - center_y) * morph * 0.6);
          var sx = Math.max(mid_l, Math.min(mid_r, xx + dx));
          var sy = Math.max(content_top, Math.min(content_bt, yy + dy));
          c.put(sx, sy, '01EX'.charAt(seed % 4), morph > .7 ? G : N);
        } else {
          var scan = py.pymod(yy - content_top - Math.trunc(elapsed * 9),
                              Math.max(1, content_bt - content_top + 1));
          // The implicit equation is only a silhouette mask; thresholding its
          // magnitude would carve false holes, so the texture does the fill.
          var texture = hash16(seed + py.pyfloor(frame, 2));
          c.put(xx, yy, texture % 8 < 2 ? '01'.charAt(texture % 2) : '#', scan < 2 ? W : B);
        }
      } else if (executing) {
        // Expanding execution wave and dim opcode fragments behind the title.
        var radius = Math.abs(xx - cx) / Math.max(1, mw / 2) + Math.abs(yy - center_y) / Math.max(1, half_h);
        var wave = py.pymod((t - 69.259) * 3, 2);
        if (Math.abs(radius - wave) < .12) c.put(xx, yy, '=', B);
        else if (seed % 31 === 0) c.put(xx, yy, '01'.charAt(seed % 2), G);
      }
    }
  }
  // Bright data packets flow from both edge panels into the center.
  for (var lane = 0; lane < 3; lane++) {
    var lane_y = Math.trunc(center_y) + (lane - 1) * Math.max(1, Math.trunc(half_h * .7));
    var path = Math.max(2, py.pyfloor(mw - 6, 2));
    var head = py.pymod(Math.trunc(elapsed * (loading ? 28 : 16) + lane * 7), path);
    for (var tail = 0; tail < 4; tail++) {
      var step = Math.max(0, head - tail);
      var ink = tail === 0 ? W : (tail < 2 ? B : G);
      var heads = [[mid_l + step, '>'], [mid_r - step, '<']];
      for (var hi = 0; hi < 2; hi++) {
        var hx = heads[hi][0], head_char = heads[hi][1];
        var hnx = (hx - cx) / (half_w * beat);
        var hny = -(lane_y - center_y) / (half_h * beat) + .20;
        var inside = Math.pow(hnx * hnx + hny * hny - 1, 3) - hnx * hnx * Math.pow(hny, 3) <= 0;
        if (inside && !loading) {
          c.put(hx, lane_y, tail === 0 ? '#' : '01'.charAt(py.pymod(hx + lane_y + frame, 2)),
                tail === 0 ? W : B);
        } else {
          c.put(hx, lane_y, tail === 0 ? head_char : '-', ink);
        }
      }
    }
  }
  if (executing) {
    var title_y = Math.trunc(center_y) - 2;
    clear(c, mid_l, title_y, mw, 5);
    if (mw >= 53) c.big(title_y, 'EXECUTION', W);
    else middle(title_y + 2, '>> EXECUTION <<', W);
    middle(title_y - 2, '[ YOU.HAPPY == TRUE ]', B);
    middle(title_y + 6, 'world.execute(me);', W);
  } else if (loading) {
    middle(Math.trunc(center_y), '[ RUN THE EXECUTION ]', W);
  } else {
    middle(Math.trunc(center_y), 'YOU.HAPPY', W);
  }
  middle(bt - 1, 'EXECUTION: ' + (executing ? 'RUN' : (loading ? 'QUEUED' : 'READY')), B);
  middle(bt, 'ME -> YOU / ' + (executing ? 'SELF COMMITTED' : (loading ? 'COMPILING...' : 'MAKE YOU HAPPY')), N);
}

function lyric_trapped_simulation(c, t, area, pulse) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var age = t - 70.084;
  var strange = clamp((t - 71.764) / 1.405);
  var reveal = t >= 73.169;
  var rail = Math.max(10, Math.min(19, py.pyfloor(c.w, 6)));
  var ml = l + rail + 1, mr = r - rail - 1, mw = mr - ml + 1;
  var inner_top = top + 2, inner_bt = bt - 2;
  var hh = Math.max(2, (inner_bt - inner_top) / 2);
  var center_y = (inner_top + inner_bt) / 2;
  var frame = Math.trunc(age * (22 + strange * 20));
  var middle = function (y, text, style) {
    if (style === undefined) style = N;
    text = text.slice(0, mw);
    c.put(ml + py.pyfloor(mw - text.length, 2), y, text, style);
  };
  // Full-height memory walls scroll in opposite directions and keep resetting.
  var walls = [[l, 'HEAP / ME', 1], [r - rail + 1, 'STACK / YOU', -1]];
  for (var wall = 0; wall < walls.length; wall++) {
    var wx = walls[wall][0], label = walls[wall][1], direction = walls[wall][2];
    c.box(wx, top, rail, bt - top + 1, B);
    c.put(wx + 1, top, label.slice(0, rail - 2), W);
    for (var yy = top + 1; yy < bt; yy++) {
      var step = py.pymod(frame * direction + yy - top, 256);
      var value = hash16(step * 53);
      var text = step % 4 ? py.padHex(step * 16, 4) + ' ' + py.padHex(value, 4)
               : (step % 8 ? 'LOOP ' : 'EXEC ') + py.padHex(value, 4);
      c.put(wx + 1, yy, text.slice(0, rail - 2),
            step % 13 === 0 ? W : (step % 3 ? N : G));
    }
  }
  // A warped coordinate lattice covers the whole central simulation volume.
  for (var ly = inner_top; ly <= inner_bt; ly++) {
    for (var lx = ml; lx <= mr; lx++) {
      var bend = Math.sin((ly - center_y) * .32 + age * 3.1) * strange * 6;
      var gx = Math.trunc(lx + bend + age * 5);
      var gy = Math.trunc(ly + Math.sin((lx - cx) * .12 - age * 2) * strange * 3);
      if (gx % 8 === 0 || gy % 4 === 0) {
        c.put(lx, ly, gx % 8 === 0 && gy % 4 === 0 ? '+' : (gx % 8 === 0 ? ':' : '.'), G);
      } else if (hash16(lx * 17 + ly * 79 + py.pyfloor(frame, 3)) % 109 === 0) {
        c.put(lx, ly, '01'.charAt(hash16(lx + ly) % 2), N);
      }
    }
  }
  // Recurring perspective frames: every apparent exit leads into another cell.
  for (var layer = 0; layer < 8; layer++) {
    var phase = py.pymod(layer / 8 + age * (.20 + strange * .25), 1);
    var scale = .12 + .88 * Math.pow(phase, 1.5);
    var skew = Math.sin(age * 2 + layer * .8) * strange * mw * .10;
    var x0 = cx - mw * .48 * scale, x1 = cx + mw * .48 * scale;
    var y0 = center_y - hh * .95 * scale, y1 = center_y + hh * .95 * scale;
    var theta = strange * Math.sin(age * 3 + layer);
    var corners = [[x0 + skew, y0], [x1, y0 + theta], [x1 - skew, y1], [x0, y1 - theta]];
    for (var index = 0; index < 4; index++) {
      var ca = corners[index], cb = corners[(index + 1) % 4];
      c.line(Math.max(ml, Math.min(mr, ca[0])), ca[1],
             Math.max(ml, Math.min(mr, cb[0])), cb[1],
             layer % 3 === 0 ? '=' : '-', layer % 3 === 0 ? N : G);
    }
    if (layer % 2 === 0 && scale > .6) {
      c.put(Math.max(ml, Math.trunc(x0)), Math.trunc(y0), 'LOOP ' + py.padInt(layer, 2, '0'), N);
    }
  }
  // The outer gate visibly contracts around both entities on "we are trapped".
  var close = clamp(age / .85);
  var box_w = Math.max(20, Math.trunc(mw * (.98 - .22 * close)));
  var box_h = Math.max(7, Math.trunc((inner_bt - inner_top + 1) * (.98 - .16 * close)));
  var bx = cx - py.pyfloor(box_w, 2);
  var by = Math.trunc(center_y) - py.pyfloor(box_h, 2);
  if (!reveal) {
    c.box(bx, by, box_w, box_h, B);
    // Sliding bars lock from both sides; their gaps then oscillate unnaturally.
    for (var bar = 1; bar < 7; bar++) {
      var bar_x = bx + py.pyfloor(bar * (box_w - 1), 7);
      var jitter = Math.trunc(Math.sin(age * 5 + bar) * strange * 2);
      var extent = Math.trunc((box_h - 2) * close);
      for (var row = 0; row < extent; row++) {
        var bar_y = bar % 2 ? by + 1 + row : by + box_h - 2 - row;
        c.put(bar_x + jitter, bar_y, '|', bar % 2 ? N : B);
      }
    }
    middle(by, '[ CONTAINMENT ' + (close >= 1 ? 'LOCKED' : 'CLOSING') + ' ]', W);
    var node_y = Math.trunc(center_y);
    var nodes = [[cx - Math.max(6, py.pyfloor(box_w, 4)), 'ME'],
                 [cx + Math.max(6, py.pyfloor(box_w, 4)), 'YOU']];
    for (var ni = 0; ni < 2; ni++) {
      var node_x = nodes[ni][0], name = nodes[ni][1];
      clear(c, node_x - 4, node_y - 1, 9, 3);
      c.box(node_x - 4, node_y - 1, 9, 3, W);
      c.put(node_x - py.pyfloor(name.length, 2), node_y, name, W);
    }
    c.line(cx - py.pyfloor(box_w, 4) + 5, node_y, cx + py.pyfloor(box_w, 4) - 5, node_y, '=', B);
    if (t >= 71.764) {
      middle(by + box_h - 1, 'STRANGE / RECURSION ' + py.padInt(Math.trunc(age * 13), 3, '0'), W);
    }
  } else {
    var title_y = Math.trunc(center_y) - 2;
    clear(c, ml, title_y, mw, 5);
    if (mw >= 59) c.big(title_y, 'SIMULATION', W);
    else middle(title_y + 2, '>> SIMULATION <<', W);
    middle(title_y - 2, '[ NO EXIT / SAME WORLD ]', B);
    middle(title_y + 6, '[ ME ] <== LOOP ==> [ YOU ]', W);
  }
  middle(top, 'EXECUTION -> SIMULATION', B);
  middle(top + 1, 'world.simulate(me, you);', N);
  middle(bt - 1, 'EXIT: DENIED / RESTART: ' + py.padInt(Math.trunc(age * 17), 4, '0'), B);
  middle(bt, 'TRAPPED TOGETHER / LOOP FOREVER', reveal ? W : N);
}

function lyric_heart(c, t, area, elapsed, pulse) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var scale = 0.5 + pulse * 0.15 + elapsed * 0.03;
  for (var angle_i = 0; angle_i < 60; angle_i++) {
    for (var rad_i = 0; rad_i < 15; rad_i++) {
      var angle = angle_i * TAU / 60;
      var rad = rad_i / 15;
      var x = 16 * Math.pow(Math.sin(angle), 3);
      var y = -(13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle)
                - Math.cos(4 * angle));
      x = x * scale * rad / 17;
      y = y * scale * rad / 17;
      var px = cx + x * 4, pyy = cy + y * 2;
      if (l < px && px < r && top < pyy && pyy < bt) {
        var brightness = rad * (1 + pulse * 0.3);
        c.put(px, pyy, brightness > 0.8 ? '#' : (brightness > 0.5 ? '*' : '.'),
              brightness > 0.9 ? W : (brightness > 0.6 ? B : N));
      }
    }
  }
  if (elapsed > 1) c.center(cy, '♥', R);
}

// Original organic choreography restored from the first delivered version.
function legacy_panel(c, x, y, w, h, label) {
  clear(c, x, y, w, h);
  c.box(x, y, w, h, D);
  c.put(x + 2, y, ' ' + label.slice(0, Math.max(0, w - 6)) + ' ', N);
}

function legacy_workspace(c, t, top, bt, label, status) {
  if (status === undefined) status = 'ACTIVE';
  c.put(2, top, label, W);
  c.put(Math.max(3, c.w - status.length - 3), top, status, B);
  c.put(2, top + 1, py.pyRepeat('-', c.w - 4), G);
  var side = c.w >= 100 ? Math.min(25, Math.max(17, py.pyfloor(c.w, 6))) : 0;
  if (side) {
    var lx = 2, rx = c.w - side - 2, ph = bt - top - 2;
    legacy_panel(c, lx, top + 2, side, ph, 'REGISTER');
    legacy_panel(c, rx, top + 2, side, ph, 'PROCESS');
    var k = Math.trunc(t * 7);
    var left = ['PID 0001 : ME', 'UID 0002 : YOU',
                'PC  ' + py.padHex(hash16(k), 4), 'SP  ' + py.padHex(hash16(k + 3), 4)];
    var right = ['STATE ' + status.slice(0, 7), 'TICK ' + py.padInt(Math.trunc(t * 120), 6, '0'),
                 'CALL ' + py.padHex(hash16(k + 7), 4), 'FLAGS Z C O S'];
    var height = ph - 2;
    var ops = ['LOAD', 'PUSH', 'CALL', 'WAIT', 'COPY', 'SYNC', 'RET ', 'JMP '];
    for (var i = 0; i < height; i++) {
      var yy = top + 3 + i;
      var a, b;
      if (i < left.length) { a = left[i]; b = right[i]; }
      else if (i === 5) { a = 'HEAP ALLOCATION'; b = 'STACK TRACE'; }
      else {
        var j = k + i;
        a = py.padHex(i * 16, 4) + ' ' + py.padHex(hash16(j), 4) + ' ' + py.padHex(hash16(j + 19), 4);
        b = ops[j % 8] + ' @' + py.padHex(hash16(j * 3), 4);
      }
      c.put(lx + 2, yy, a.slice(0, side - 4), i < 4 ? N : G);
      c.put(rx + 2, yy, b.slice(0, side - 4), i < 4 ? N : G);
    }
    var sweep = py.pymod(Math.trunc(t * 8), Math.max(1, height));
    c.put(lx + 1, top + 3 + sweep, '>', B);
    c.put(rx + side - 2, top + 3 + (height - 1 - sweep), '<', B);
  }
  return [side ? side + 4 : 4, top + 3, side ? c.w - side - 5 : c.w - 5, bt - 1];
}

function legacy_mesh(c, t, area, form, pulse) {
  if (form === undefined) form = 'torus';
  if (pulse === undefined) pulse = 0;
  var zbuf = new Map();
  for (var u = 0; u < 78; u++) {
    var a = u * TAU / 78;
    for (var v = 0; v < 26; v++) {
      var b = v * TAU / 26;
      var x, y, z;
      if (form === 'torus') {
        x = (.76 + .29 * Math.cos(b)) * Math.cos(a);
        y = (.76 + .29 * Math.cos(b)) * Math.sin(a);
        z = .29 * Math.sin(b);
      } else if (form === 'sphere') {
        x = Math.sin(b) * Math.cos(a); y = Math.cos(b); z = Math.sin(b) * Math.sin(a);
      } else if (form === 'heart') {
        var hradius = .5 + .5 * Math.cos(b);
        x = (16 * Math.pow(Math.sin(a), 3) / 17) * hradius;
        y = -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a)
              - Math.cos(4 * a)) / 17 * hradius;
        z = .38 * Math.sin(b) * Math.sin(a);
        x *= 1 + pulse * .12; y *= 1 + pulse * .12;
      } else if (form === 'eggplant') {
        x = Math.sin(b) * Math.cos(a) * (.43 + .16 * Math.cos(b));
        y = Math.cos(b) * 1.2;
        z = Math.sin(b) * Math.sin(a) * .6;
      } else if (form === 'tomato') {
        x = Math.sin(b) * Math.cos(a); y = Math.cos(b) * .68; z = Math.sin(b) * Math.sin(a);
      } else {
        x = (.68 + .25 * Math.cos(3 * a + b)) * Math.cos(2 * a);
        y = (.68 + .25 * Math.cos(3 * a + b)) * Math.sin(2 * a);
        z = .5 * Math.sin(3 * a + b);
      }
      var projected = point(x, y, z, area, form !== 'heart' ? t : Math.sin(t * .45) * 1.2);
      var key = py.pyRound(projected[0]) + ',' + py.pyRound(projected[1]);
      var entry = zbuf.get(key);
      if (!entry || projected[2] < entry[0]) zbuf.set(key, [projected[2], a, b]);
    }
  }
  var ramp = '.,:;=+*#@';
  var l = area[0], y0 = area[1], r = area[2], bt = area[3];
  zbuf.forEach(function (entry, key) {
    var parts = key.split(',');
    var x = Number(parts[0]), yy = Number(parts[1]);
    if (!(l <= x && x <= r && y0 <= yy && yy <= bt)) return;
    var z = entry[0], a = entry[1], b = entry[2];
    var light = clamp(.45 - z * .30 + Math.sin(a * 2 + b + t * .3) * .13);
    c.put(x, yy, ramp.charAt(Math.trunc(light * (ramp.length - 1))),
          light > .77 ? B : (light > .40 ? N : G));
  });
}

function legacy_ring(c, t, area, turns) {
  if (turns === undefined) turns = 3;
  var l = area[0], y = area[1], r = area[2], b = area[3];
  var cx = (l + r) / 2, cy = (y + b) / 2;
  for (var k = 0; k < turns; k++) {
    var rr = .32 + k * .058;
    for (var i = 0; i < 140; i++) {
      var a = i * TAU / 140;
      if ((i + k * 9) % 23 < 5) continue;
      c.put(cx + Math.cos(a) * (r - l) * rr, cy + Math.sin(a) * (b - y) * rr,
            k % 2 ? '.' : ':', k !== 1 ? G : D);
    }
    var head_a = t * (.6 + k * .1) + k * 2;
    for (var j = 0; j < 14; j++) {
      var aa = head_a - j * .018;
      c.put(cx + Math.cos(aa) * (r - l) * rr, cy + Math.sin(aa) * (b - y) * rr,
            j === 0 ? '+' : '.', j === 0 ? W : G);
    }
  }
}

function legacy_organic(c, t, top, bt, pulse) {
  var i = t < 77.576 ? 0 : (t < 81.351 ? 1 : (t < 85.078 ? 2 : 3));
  var subject = ['EGGPLANT', 'TOMATO', 'TABBY CAT', 'GOD'][i];
  var resource = ['NUTRIENTS', 'ANTIOXIDANTS', 'ENJOYMENT', 'EXISTENCE'][i];
  var area = legacy_workspace(c, t, top, bt, 'TYPE CAST / ' + subject, 'EXPORT');
  var l = area[0], y = area[1], r = area[2], b = area[3];
  var cx = (l + r) / 2, cy = (y + b) / 2;
  if (i === 0 || i === 1) {
    legacy_mesh(c, t, [l, y, cx + 6, b], i === 0 ? 'eggplant' : 'tomato');
  } else if (i === 2) {
    var vs = [[-.9, -.8, 0], [-.75, .4, 0], [0, .75, 0], [.75, .4, 0], [.9, -.8, 0],
              [.4, -.4, 0], [-.4, -.4, 0], [-.28, 0, -.1], [.28, 0, -.1], [0, .25, -.2]];
    var es = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0], [7, 9], [8, 9], [5, 8], [6, 7]];
    projected(c, vs, es, [l, y, cx + 8, b], Math.sin(t) * .5);
    var sides = [-1, 1];
    for (var si = 0; si < 2; si++) {
      for (var j = 0; j < 3; j++) {
        c.line(l + (cx - l) / 2, cy + 1, l + (cx - l) / 2 + sides[si] * 11, cy + j - 1, '.', N);
      }
    }
  } else {
    legacy_mesh(c, t, [l, y, cx + 8, b], 'sphere');
    legacy_ring(c, t, [l, y, cx + 8, b], 4);
  }
  var target = py.pyRound(mix(cx, r, .67));
  c.box(target - 5, Math.trunc(cy - 2), 11, 5, N);
  c.put(target - 3, cy, 'YOU_02', W);
  for (var k = 0; k < 5; k++) {
    var yy = cy - 2 + k;
    c.line(cx - 1, yy, target - 6, yy, '.', G);
    var xx = mix(cx, target - 6, py.pymod(t * .8 + k * .2, 1));
    c.put(xx, yy, '>>', k === 2 ? B : D);
  }
  c.center(y, 'convert(self, ' + resource.toLowerCase() + ');', W);
  c.center(b, 'TX ' + py.padHex(Math.trunc(py.pymod(t, 3) / 3 * 65535), 4) + '  |  ' + resource
           + ' -> YOU  |  ACK', N);
}

function legacy_phosphor(c, t, top, bt) {
  // Luminance scan and short signal tears, confined above the captions.
  var row = top + py.pymod(Math.trunc(t * 9), Math.max(1, bt - top + 1));
  for (var x = 2; x < c.w - 2; x++) {
    var cell = c.cells[row][x];
    if (cell[0] !== '' && cell[0] !== ' ' && (cell[1] === D || cell[1] === N || cell[1] === G)) {
      c.cells[row][x] = [cell[0], cell[1] === G ? N : B];
    }
  }
  if (125.708 < t && t < 177.246 && (py.pymod(Math.trunc(t * 13), 17) === 0
                                     || py.pymod(Math.trunc(t * 13), 17) === 1)) {
    var yy = top + hash16(Math.trunc(t * 13)) % Math.max(1, bt - top);
    var shift = py.pymod(Math.trunc(t * 13), 2) ? 2 : -3;
    var target = c.cells[yy];
    var source = py.rotateRow(target.slice(2, target.length - 2), shift);
    var args = [2, target.length - 4].concat(source);
    Array.prototype.splice.apply(target, args);
  }
}

function lyric_eggplant_tomato(c, t, area, item) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  for (var y = top; y < bt; y++) {
    for (var x = l; x < r; x++) {
      var dx = (x - cx) / 4, dy = (y - cy) / 2;
      var dist = Math.hypot(dx, dy);
      if (item === 'eggplant') {
        if (dist < 6 && Math.abs(dy) < 8) c.put(x, y, dist < 4 ? '█' : '▓', dy < 0 ? B : N);
      } else {
        if (dist < 5) c.put(x, y, dist < 3 ? '●' : 'o', dist < 3 ? R : N);
      }
    }
  }
  c.center(cy + Math.trunc((bt - top) * 0.3), item.toUpperCase(), B);
}

function lyric_cat(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var cat = [
    "  /\\_/\\  ",
    " ( o.o ) ",
    "  > ^ <  ",
    " /|   |\\ "
  ];
  for (var i = 0; i < cat.length; i++) c.center(cy - 2 + i, cat[i], i < 3 ? B : N);
  if (elapsed > 0.5) {
    for (var p = 0; p < 5; p++) {
      var phase = py.pymod(elapsed * 2 + p * 0.2, 1);
      c.put(cx + Math.trunc(phase * 20) - 10, cy + 3, phase < 0.8 ? '~' : '', G);
    }
  }
  c.center(cy + 5, '*purr*', G);
}

function lyric_god_existence(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  for (var ring = 0; ring < 8; ring++) {
    var radius = 5 + ring * 4 + Math.sin(t * 2 + ring) * 2;
    var density = 60 - ring * 5;
    for (var i = 0; i < density; i++) {
      var angle = i * TAU / density + t * 0.1 * Math.pow(-1, ring);
      var brightness = 1 - ring / 8;
      c.put(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.5,
            brightness > 0.7 ? '*' : (brightness > 0.4 ? '+' : '.'),
            brightness > 0.8 ? W : (brightness > 0.5 ? B : N));
    }
  }
  c.center(cy, 'GOD', W);
  c.center(cy + 2, 'YOU', B);
}

function identity_bitmap(c, x, y, text, sx, sy, ink, fill, seed) {
  if (fill === undefined) fill = 1;
  if (seed === undefined) seed = 0;
  var glyphs = {
    'F': ['11111', '11000', '11110', '11000', '11000'],
    'M': ['10001', '11011', '10101', '10001', '10001'],
    'A': ['01110', '11011', '11111', '11011', '11011'],
    'P': ['11110', '11011', '11110', '11000', '11000'],
  };
  for (var index = 0; index < text.length; index++) {
    var glyph = glyphs[text.charAt(index)];
    for (var dy = 0; dy < glyph.length; dy++) {
      for (var dx = 0; dx < glyph[dy].length; dx++) {
        if (glyph[dy].charAt(dx) === '1') {
          for (var pyi = 0; pyi < sy; pyi++) {
            for (var pxi = 0; pxi < sx; pxi++) {
              var xx = x + (index * 6 + dx) * sx + pxi, yy = y + dy * sy + pyi;
              var on = hash16((index * 31 + dx) * 73 + dy * 137 + pxi * 19 + pyi + seed) / 65535 <= fill;
              c.put(xx, yy, on ? '#' : '.', on ? ink : G);
            }
          }
        }
      }
    }
  }
}

function lyric_identity_rewrite(c, t, area) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var age = t - 88.587;
  var u = clamp((t - 90.197) / 1.25);
  var sx = Math.max(2, Math.min(6, py.pyfloor(r - l, 22)));
  var sy = Math.max(1, Math.min(5, py.pyfloor(bt - top - 8, 5)));
  var glyph_w = 5 * sx, glyph_h = 5 * sy;
  var left_c = py.pyfloor(l + cx, 2), right_c = py.pyfloor(cx + r, 2);
  var y = cy - py.pyfloor(glyph_h, 2);
  c.center(top, 'SELF.GENDER / PARAMETER REWRITE', W);
  c.center(top + 1, 'F -> M / TRANSMIT IDENTITY', B);
  c.box(l, top + 3, cx - l - 1, bt - top - 5, G);
  c.box(cx + 2, top + 3, r - cx - 1, bt - top - 5, G);
  // Scrolling bytes fill both panes, behind the large letter masks.
  for (var row = top + 4; row < bt - 2; row += 2) {
    var tick = Math.trunc(age * 18) + row;
    c.put(l + 2, row, py.padHex(hash16(tick), 4), G);
    c.put(r - 5, row, py.padHex(hash16(tick + 79), 4), G);
  }
  for (var i = 0; i < 6; i++) {
    var yy = top + 4 + i * Math.max(1, py.pyfloor(bt - top - 8, 5));
    c.line(l + 7, yy, r - 7, yy, '.', G);
    var progress = py.pymod(age * .9 + i * .17, 1);
    c.put(mix(left_c, right_c, progress), yy, '>>', u ? W : B);
  }
  clear(c, left_c - py.pyfloor(glyph_w, 2) - 1, y - 1, glyph_w + 2, glyph_h + 2);
  clear(c, right_c - py.pyfloor(glyph_w, 2) - 1, y - 1, glyph_w + 2, glyph_h + 2);
  identity_bitmap(c, left_c - py.pyfloor(glyph_w, 2), y, 'F', sx, sy, W, 1 - u);
  identity_bitmap(c, right_c - py.pyfloor(glyph_w, 2), y, 'M', sx, sy, W, u);
  // Released source cells travel in arcs and settle into the new character.
  if (0 < u && u < 1) {
    for (var ri = 0; ri < 44; ri++) {
      var p = clamp(u * 1.6 - (ri % 11) / 18);
      var rx = mix(left_c, right_c, p);
      var yoff = (hash16(ri * 31) % Math.max(1, glyph_h)) - glyph_h / 2;
      var real_y = cy + yoff + Math.sin(p * Math.PI) * (ri % 2 ? 1 : -1) * 3;
      c.put(rx, real_y, '01#'.charAt(ri % 3), ri % 4 === 0 ? W : B);
    }
  }
  c.put(left_c - 4, bt - 3, 'SOURCE F', u < 1 ? N : G);
  c.put(right_c - 4, bt - 3, 'TARGET M', u >= 1 ? W : N);
  c.center(bt - 1, 'WRITE ' + py.padInt(Math.trunc(u * 100), 3, '0') + '% / '
           + (u >= 1 ? 'COMMITTED' : (!u ? 'COMPILING' : 'REASSEMBLING')), B);
  c.center(bt, u >= 1 ? "self.gender = 'M';" : 'self.gender: F -> M', W);
}

function lyric_daynight_clock(c, t, area) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var age = t - 92.015;
  var flip_at = 94.55;
  var is_pm = t >= flip_at;
  var virtual = is_pm
    ? 12 + 6 * clamp((t - flip_at) / (95.465 - flip_at))
    : 6 + 6 * clamp((t - 92.015) / (flip_at - 92.015));
  var clock_x = py.pyfloor(l + cx, 2), display_x = py.pyfloor(cx + r, 2);
  var rx = Math.max(6, (cx - l) * .43), ry = Math.max(3, (bt - top - 6) * .43);
  c.center(top, 'CLOCK.CYCLE / AM -> PM', W);
  c.center(top + 1, 'DAYLIGHT -> NIGHT / TIME ACCELERATING', B);
  // Clock face fills the left half instead of occupying a small central patch.
  for (var i = 0; i < 180; i++) {
    var a = i * TAU / 180;
    c.put(clock_x + Math.sin(a) * rx, cy - Math.cos(a) * ry, '.', N);
  }
  for (var hour = 0; hour < 12; hour++) {
    var ha = hour * TAU / 12;
    c.line(clock_x + Math.sin(ha) * rx * .9, cy - Math.cos(ha) * ry * .9,
           clock_x + Math.sin(ha) * rx, cy - Math.cos(ha) * ry, '#', B);
    c.put(clock_x + Math.sin(ha) * rx * .77 - 1, cy - Math.cos(ha) * ry * .77,
          String(hour || 12), N);
  }
  var hour_angle = virtual / 12 * TAU, minute_angle = py.pymod(virtual, 1) * TAU;
  for (var trail = 4; trail > 0; trail--) {
    var ta = minute_angle - trail * .13;
    c.line(clock_x, cy, clock_x + Math.sin(ta) * rx * .8, cy - Math.cos(ta) * ry * .8, '.', G);
  }
  c.line(clock_x, cy, clock_x + Math.sin(hour_angle) * rx * .52,
         cy - Math.cos(hour_angle) * ry * .52, '#', B);
  c.line(clock_x, cy, clock_x + Math.sin(minute_angle) * rx * .83,
         cy - Math.cos(minute_angle) * ry * .83, '*', W);
  c.put(clock_x, cy, '@', W);
  c.line(cx, top + 3, cx, bt - 3, '|', G);
  // Day/night symbol and huge AM/PM bitmap occupy the entire right pane.
  var radius = Math.max(3, Math.min((r - cx) * .22, (bt - top) * .34));
  for (var si = 0; si < 120; si++) {
    var sa = si * TAU / 120;
    if (!is_pm || Math.cos(sa) < .45) {
      c.put(display_x + Math.cos(sa) * radius * 1.6, cy + Math.sin(sa) * radius,
            ':', is_pm ? G : N);
    }
  }
  if (!is_pm) {
    for (var ray = 0; ray < 16; ray++) {
      var ra = ray * TAU / 16 + age * .25;
      c.line(display_x + Math.cos(ra) * radius * 1.8, cy + Math.sin(ra) * radius * 1.1,
             display_x + Math.cos(ra) * radius * 2.1, cy + Math.sin(ra) * radius * 1.3, '.', G);
    }
  } else {
    for (var star = 0; star < 22; star++) {
      var star_x = cx + 2 + hash16(star * 31) % Math.max(1, r - cx - 4);
      var star_y = top + 3 + hash16(star * 79) % Math.max(1, bt - top - 6);
      c.put(star_x, star_y, py.pymod(Math.trunc(age * 5) + star, 5) === 0 ? '+' : '.', G);
    }
  }
  var gsx = Math.max(1, Math.min(4, py.pyfloor(r - cx - 6, 11)));
  var gsy = Math.max(1, Math.min(4, py.pyfloor(bt - top - 8, 5)));
  var glyph_w = 11 * gsx, glyph_h = 5 * gsy, y0 = cy - py.pyfloor(glyph_h, 2);
  clear(c, display_x - py.pyfloor(glyph_w, 2) - 1, y0 - 1, glyph_w + 2, glyph_h + 2);
  identity_bitmap(c, display_x - py.pyfloor(glyph_w, 2), y0, is_pm ? 'PM' : 'AM', gsx, gsy, W);
  // A narrow scan sweeps down the display on the flip.
  if (0 <= t - flip_at && t - flip_at < .22) {
    var scan_y = y0 + Math.trunc((t - flip_at) / .22 * glyph_h);
    c.put(display_x - py.pyfloor(glyph_w, 2), scan_y, py.pyRepeat('=', glyph_w), W);
  }
  var hour_num = py.pymod(Math.trunc(virtual), 24);
  var minute_num = Math.trunc(py.pymod(virtual, 1) * 60);
  c.put(display_x - 2, Math.min(bt - 3, y0 + glyph_h + 1),
        py.padInt(hour_num, 2, '0') + ':' + py.padInt(minute_num, 2, '0'), W);
  c.center(bt - 1, is_pm ? '[ PM / NIGHT CYCLE ]' : '[ AM / DAY CYCLE ]', B);
  c.center(bt, 'do_whatever();  // AM -> PM', N);
}

function lyric_gender_role_switch(c, t, area, elapsed, from_label, to_label) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 2.5);

  // ===== F->M: Gender symbols transformation =====
  if (from_label === 'F' && to_label === 'M') {
    for (var i = 0; i < 150; i++) {
      var angle = i * 2.4 + t * 0.5;
      var radius = Math.sqrt(i) * 4 + Math.sin(t * 2 + i * 0.1) * 3;
      var x = cx + Math.cos(angle) * radius;
      var y = cy + Math.sin(angle) * radius * 0.5;
      var symbol, style;
      if (progress < 0.3) {
        symbol = '♀';
        style = i % 5 === 0 ? W : (i % 3 === 0 ? B : N);
      } else if (progress < 0.7) {
        symbol = py.pymod(i + Math.trunc(t * 10), 2) === 0 ? '♀' : '♂';
        style = py.pymod(i + Math.trunc(t * 20), 3) === 0 ? R : (i % 4 === 0 ? W : B);
      } else {
        symbol = '♂';
        style = i % 5 === 0 ? W : (i % 3 === 0 ? B : N);
      }
      c.put(x, y, symbol, style);
    }
    if (0.3 < progress && progress < 0.7) {
      var burst_progress = (progress - 0.3) / 0.4;
      for (var burst_i = 0; burst_i < 60; burst_i++) {
        var burst_angle = burst_i * TAU / 60 + t * 3;
        var burst_r = burst_progress * 50;
        c.put(cx + Math.cos(burst_angle) * burst_r, cy + Math.sin(burst_angle) * burst_r * 0.5,
              burst_i % 3 === 0 ? '⚥' : '*', W);
      }
    }
    var scale = Math.trunc(8 + Math.trunc(Math.sin(t * 2) * 2));
    var center_symbol = progress < 0.5 ? '♀' : '♂';
    for (var dy = -scale; dy <= scale; dy++) {
      for (var dx = -scale * 2; dx <= scale * 2; dx++) {
        var dist = Math.hypot(dx / 2, dy);
        if (dist < scale) {
          c.put(cx + dx, cy + dy, center_symbol,
                dist < scale * 0.4 ? W : (dist < scale * 0.7 ? B : N));
        }
      }
    }
  } else if (from_label === 'AM' && to_label === 'PM') {
    var radius_clock = Math.trunc(Math.min(r - l, bt - top) * 0.35);
    for (var ci = 0; ci < 120; ci++) {
      var cangle = ci * TAU / 120;
      c.put(cx + Math.cos(cangle) * radius_clock, cy + Math.sin(cangle) * radius_clock * 0.5,
            ci % 10 === 0 ? '○' : '·', B);
    }
    var marker_hours = [0, 3, 6, 9];
    for (var mh = 0; mh < marker_hours.length; mh++) {
      var hour = marker_hours[mh];
      var mangle = hour * TAU / 12 - TAU / 4;
      c.put(cx + Math.cos(mangle) * radius_clock * 0.85,
            cy + Math.sin(mangle) * radius_clock * 0.85 * 0.5,
            String(hour !== 0 ? hour : 12), W);
    }
    var current_hour = mix(6, 18, progress);
    var hour_angle = current_hour * TAU / 12 - TAU / 4;
    var hour_length = Math.trunc(radius_clock * 0.5);
    for (var step = 0; step < hour_length; step++) {
      c.put(cx + Math.cos(hour_angle) * step, cy + Math.sin(hour_angle) * step * 0.5,
            '═', step > hour_length * 0.7 ? W : B);
    }
    var minute_angle = py.pymod(t * 6, TAU) - TAU / 4;
    var minute_length = Math.trunc(radius_clock * 0.7);
    for (var mstep = 0; mstep < minute_length; mstep++) {
      c.put(cx + Math.cos(minute_angle) * mstep, cy + Math.sin(minute_angle) * mstep * 0.5,
            '─', mstep > minute_length * 0.8 ? B : N);
    }
    for (var digit_y = 0; digit_y < Math.trunc((bt - top) * 0.6); digit_y++) {
      var phase = py.pymod(progress * 3 + digit_y * 0.05, 1);
      if (phase < 0.8) {
        var digit_x = Math.trunc(cx + Math.sin(phase * TAU) * 30);
        var hour_shown = py.pymod(Math.trunc(mix(6, 18, phase)), 24);
        c.put(digit_x, top + digit_y, py.padInt(hour_shown, 2, '0'),
              phase > 0.6 ? W : (phase > 0.3 ? B : G));
      }
    }
    var display_hour = py.pymod(Math.trunc(current_hour), 24);
    c.center(cy + Math.trunc((bt - top) * 0.25), py.padInt(display_hour, 2, '0') + ':00', W);
    c.center(cy + Math.trunc((bt - top) * 0.32), current_hour < 12 ? 'AM' : 'PM',
             current_hour >= 12 ? R : B);
  } else {
    // ===== S->M: Dominance to submission (chains/waves) =====
    if (progress < 0.5) {
      for (var row = top; row <= bt; row += 3) {
        for (var x2 = l; x2 < r; x2 += 8) {
          var offset = Math.trunc(py.pymod(t * 10 + row, 8));
          var pattern = row % 6 < 3 ? '╱╲' : '╲╱';
          c.put(x2 + offset, row, pattern.charAt(0), N);
          c.put(x2 + offset + 1, row, pattern.charAt(1), N);
        }
      }
    } else {
      for (var wave_y = 0; wave_y < 12; wave_y++) {
        var wy = top + Math.trunc(wave_y * (bt - top) / 11);
        for (var wx = l; wx < r; wx++) {
          var wave = (wx - l) / (r - l) * TAU * 3 - t * 2;
          var amplitude = (bt - top) * 0.1 * (progress - 0.5) * 2;
          var woffset = Math.trunc(Math.sin(wave) * amplitude);
          c.put(wx, wy + woffset, wave_y % 2 === 0 ? '~' : '≈',
                wave_y % 3 === 0 ? B : N);
        }
      }
    }
    if (progress < 0.4) {
      var spike_count = 8;
      for (var si = 0; si < spike_count; si++) {
        var sangle = si * TAU / spike_count + t * 0.5;
        for (var r_step = 0; r_step < 20; r_step++) {
          var spike_r = 15 + r_step * 1.5;
          if (Math.abs(py.pymod(sangle, TAU / spike_count)) < 0.2) {
            c.put(cx + Math.cos(sangle) * spike_r, cy + Math.sin(sangle) * spike_r * 0.5,
                  r_step % 2 === 0 ? '▲' : '△',
                  r_step > 15 ? W : (r_step > 10 ? B : N));
          }
        }
      }
    } else if (progress < 0.6) {
      var trans = (progress - 0.4) / 0.2;
      for (var bi = 0; bi < 80; bi++) {
        var bangle = bi * TAU / 80;
        var bradius = trans * 60;
        c.put(cx + Math.cos(bangle) * bradius + Math.sin(t * 4 + bi) * 5 * (1 - trans),
              cy + Math.sin(bangle) * bradius * 0.5 + Math.cos(t * 4 + bi) * 3 * (1 - trans),
              bi % 3 === 0 ? '*' : '·', trans < 0.5 ? W : B);
      }
    } else {
      for (var ring = 0; ring < 8; ring++) {
        var ring_r = 8 + ring * 4;
        var density = Math.trunc(ring_r * 6);
        for (var di = 0; di < density; di++) {
          var dangle = di * TAU / density + t * 0.3 * Math.pow(-1, ring);
          c.put(cx + Math.cos(dangle) * ring_r, cy + Math.sin(dangle) * ring_r * 0.5,
                ring % 2 === 0 ? '○' : '◯',
                ring < 3 ? W : (ring < 5 ? B : N));
        }
      }
    }
    var size = Math.trunc(10 + Math.sin(t * 1.5) * 1.5);
    var center_char = progress < 0.5 ? 'S' : 'M';
    for (var cdy = -size; cdy <= size; cdy++) {
      for (var cdx = -size * 2; cdx <= size * 2; cdx++) {
        var cdist = Math.hypot(cdx / 2, cdy);
        if (size * 0.3 < cdist && cdist < size * 0.8) {
          c.put(cx + cdx, cy + cdy, center_char, cdist > size * 0.6 ? W : B);
        }
      }
    }
  }
  // Common elements: Status and decorations
  c.center(top, from_label + ' → ' + to_label, progress > 0.8 ? W : B);
  c.center(bt, 'TRANSFORMATION: ' + Math.trunc(progress * 100) + '%', N);
}

function ecg_sample(phase) {
  var points = [[0, 0], [.08, 0], [.12, .15], [.17, 0], [.28, 0], [.31, -.18],
                [.35, 1.0], [.39, -.32], [.43, 0], [.52, 0], [.60, .25], [.70, 0], [1, 0]];
  phase = py.pymod(phase, 1);
  for (var i = 1; i < points.length; i++) {
    var x1 = points[i][0], y1 = points[i][1];
    var x0 = points[i - 1][0], y0 = points[i - 1][1];
    if (phase <= x1) return mix(y0, y1, (phase - x0) / (x1 - x0));
  }
  return 0;
}

function lyric_vibration_sync(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var compact = bt - top < 19;
  var sync = clamp((t - 107.22) / (110.221 - 107.22));
  var complete = t >= 110.221;
  var phase_lag = .28 * (1 - sync);
  var bpm = 72;
  c.put(l, top, 'ECG / DUAL CHANNEL', B);
  c.put(r - 10, top, py.padInt(bpm, 3, '0') + ' BPM', W);
  if (!compact) {
    var title = complete ? 'COMPLETION / RHYTHM LOCKED'
              : (t >= 107.22 ? 'PHASE SYNCHRONIZING'
              : (t >= 106.293 ? 'VIBRATIONS DETECTED' : 'ACQUIRING YOUR HEARTBEAT'));
    c.center(top + 1, title, complete ? W : N);
  }
  var plot_top = top + (compact ? 2 : 4);
  var plot_bt = bt - (compact ? 1 : 3);
  var split = py.pyfloor(plot_top + plot_bt, 2);
  var x0 = l + 1, x1 = r - 1, span = x1 - x0 + 1;
  // Three beats fit the screen. The head traverses it every 2.5 seconds.
  var speed = span / 2.5;
  var sweep = elapsed * speed + span * .30;
  var head = x0 + py.pymod(Math.trunc(sweep), span);
  var gap = Math.max(2, Math.trunc(span * .025));
  for (var yy = plot_top; yy <= plot_bt; yy++) {
    for (var xx = x0; xx <= x1; xx++) {
      if ((xx - x0) % 10 === 0 && (yy - plot_top) % 3 === 0) c.put(xx, yy, '+', G);
      else if ((yy - plot_top) % 3 === 0 && (xx - x0) % 2 === 0) c.put(xx, yy, '.', G);
    }
  }
  for (var hy = plot_top; hy <= plot_bt; hy++) c.put(head, hy, ':', G);
  var lanes = [[plot_top, split, 'YOU', 0], [split + 1, plot_bt, 'ME', phase_lag]];
  for (var lane = 0; lane < lanes.length; lane++) {
    var lane_start = lanes[lane][0], lane_end = lanes[lane][1];
    var name = lanes[lane][2], lag = lanes[lane][3];
    var height = lane_end - lane_start + 1;
    var baseline = lane_start + Math.trunc((height - 1) * .68);
    var amplitude = Math.max(1, (height - 2) * .58);
    c.put(x0, lane_start, name, lane === 0 || complete ? W : N);
    var previous = null, previous_age = 0;
    // Sub-cell sampling connects the steep QRS spike instead of leaving isolated dots.
    for (var sample = 0; sample < span * 4; sample++) {
      var sx = x0 + sample / 4;
      var age = py.pymod(head - sx, span);
      if (age > span - gap) { previous = null; continue; }
      var signal_time = elapsed - age / speed;
      var phase = signal_time * bpm / 60 - lag;
      var yy2 = baseline - ecg_sample(phase) * amplitude;
      yy2 = Math.max(lane_start, Math.min(lane_end, yy2));
      var ink = age < span * .10 ? W : (age < span * .50 ? B : N);
      if (lane === 1 && !complete) ink = age < span * .15 ? B : N;
      if (previous !== null) {
        // Crossing the sweep reset starts a new path; it must not create a false spike.
        if (Math.abs(age - previous_age) < 2) {
          var dy = yy2 - previous[1];
          var char = Math.abs(dy) > .65 ? '|' : (dy < -.13 ? '/' : (dy > .13 ? '\\' : '-'));
          c.line(previous[0], previous[1], sx, yy2, char, ink);
        }
      }
      previous = [sx, yy2]; previous_age = age;
    }
    var tip = baseline - ecg_sample(elapsed * bpm / 60 - lag) * amplitude;
    tip = Math.max(lane_start, Math.min(lane_end, tip));
    // Bright writing point with a short phosphor afterglow, independent of terminal theme.
    c.put(head - 1, tip, '=', B);
    c.put(head, tip, '@', W);
    if (!compact) {
      c.put(x1 - 7, lane_start, complete ? 'IN SYNC' : (lane === 0 ? 'SENSED' : 'SEEKING'),
            complete ? B : N);
    }
  }
  var indicator = ecg_sample(elapsed * bpm / 60) > .65 ? '*' : '.';
  if (!compact) {
    c.put(l, bt - 1, 'BEAT [' + indicator + ']  /  YOU -> ME', B);
    var status = 'SYNC ' + py.padInt(Math.trunc(sync * 100), 3, '0') + '%  DELAY '
               + py.padInt(Math.trunc(phase_lag * 1000 / (bpm / 60)), 3, '0') + 'ms';
    c.put(r - status.length + 1, bt - 1, status, complete ? W : B);
  }
  c.center(bt, complete ? '[ COMPLETION / HEARTBEATS SYNCHRONIZED ]'
           : (t < 107.22 ? '[ FEEL YOUR VIBRATIONS ]' : '[ MATCHING YOUR RHYTHM ]'),
           complete ? W : N);
}

function lyric_isolation_disconnect(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = (l + r) / 2, cy = (top + bt) / 2;
  var rx = (r - l) * .39, ry = Math.max(3, (bt - top - 6) * .39);
  var breaks = [.70, 1.32, 2.20, 3.28, 4.02, 4.88];
  var gone = 0;
  for (var g = 0; g < breaks.length; g++) if (elapsed >= breaks[g]) gone += 1;
  c.center(top, 'CONNECTION LOSS / ' + py.padInt(gone, 2, '0') + ' OF 06', gone > 3 ? R : B);
  // Radar arcs and data streams remain active through the whole isolation phrase.
  for (var ring = 0; ring < 3; ring++) {
    var sweep = py.pymod(elapsed * .34 + ring / 3, 1);
    for (var sample = 0; sample < 96; sample++) {
      var a = sample * TAU / 96;
      if (sample % 7 < 4) {
        c.put(cx + Math.cos(a) * rx * sweep, cy + Math.sin(a) * ry * sweep, '.', G);
      }
    }
  }
  for (var side = 0; side < 2; side++) {
    var side_x = side === 0 ? l : r - 9;
    for (var row = top + 2; row < bt - 1; row += 2) {
      var tick = Math.trunc(elapsed * 13) + row * (side ? 1 : -1);
      c.put(side_x, row, py.padHex(hash16(tick * 31), 4) + ' '
            + (hash16(tick) % 6 < gone ? 'LOST' : 'PING'), side ? G : N);
    }
  }
  for (var i = 0; i < breaks.length; i++) {
    var cut = breaks[i];
    var angle = (i + .5) * TAU / 6;
    var nx = cx + Math.cos(angle) * rx, ny = cy + Math.sin(angle) * ry;
    var age = elapsed - cut;
    // A shared outer network also unravels as each radial connection fails.
    var next_a = (i + 1.5) * TAU / 6;
    if (age < .4) {
      c.line(nx, ny, cx + Math.cos(next_a) * rx, cy + Math.sin(next_a) * ry, ':', G);
    }
    var steps = Math.max(12, Math.trunc(rx));
    var rupture = clamp(age / 1.1);
    for (var j = 0; j < steps; j++) {
      var u = j / Math.max(1, steps - 1);
      if (age >= 0 && Math.abs(u - .55) < rupture * .6) continue;
      var jitter = Math.sin(j * 2 + elapsed * 35) * (-.35 < age && age < .5 ? .55 : .08);
      c.put(mix(cx, nx, u), mix(cy, ny, u) + jitter,
            -.35 < age && age < .2 ? '=' : '.',
            -.2 < age && age < .2 ? W : (age < 0 ? N : G));
    }
    if (age < 0) {
      for (var packet = 0; packet < 3; packet++) {
        var pu = py.pymod(elapsed * .65 + packet / 3 + i * .1, 1);
        c.put(mix(nx, cx, pu), mix(ny, cy, pu), '*', W);
      }
      c.box(Math.trunc(nx) - 4, Math.trunc(ny) - 1, 9, 3, B);
      c.put(nx - 3, ny, 'YOU_' + (i + 1), W);
    } else {
      // Recoil, sparks and a fading shock ring keep every break visible.
      var drift = Math.min(1, age / 2);
      var ox = nx + Math.cos(angle) * drift * 4, oy = ny + Math.sin(angle) * drift * 2;
      c.put(ox - 3, oy, '[LOST]', age < .8 ? R : G);
      if (age < 2.3) {
        for (var particle = 0; particle < 22; particle++) {
          var p_angle = hash16(i * 97 + particle * 19) / 65535 * TAU;
          var velocity = 2 + hash16(particle * 17 + i) % 8;
          var distance = age * velocity;
          var px = nx + Math.cos(p_angle) * distance, pyy = ny + Math.sin(p_angle) * distance * .45;
          if (l < px && px < r && top + 1 < pyy && pyy < bt - 1) {
            c.put(px, pyy, age < .3 ? '*' : '+:. '.charAt(Math.min(3, Math.trunc(age * 1.5))),
                  age < .3 ? W : (age < .9 ? B : G));
          }
        }
        for (var p = 0; p < 30; p++) {
          var ring_angle = p * TAU / 30;
          var rpx = nx + Math.cos(ring_angle) * age * 8, rpy = ny + Math.sin(ring_angle) * age * 3.5;
          if (l < rpx && rpx < r && top + 1 < rpy && rpy < bt - 1) {
            c.put(rpx, rpy, ':', age < .5 ? B : G);
          }
        }
      }
      // Retry packets leave ME, then stop short of the missing endpoint.
      var ru = py.pymod(elapsed * .6 + i * .16, 1) * .78;
      c.put(mix(cx, nx, ru), mix(cy, ny, ru), ru > .63 ? 'x' : '>', ru > .63 ? R : N);
    }
  }
  clear(c, Math.trunc(cx) - 5, Math.trunc(cy) - 2, 11, 5);
  c.box(Math.trunc(cx) - 5, Math.trunc(cy) - 2, 11, 5, W);
  c.put(cx - 2, cy - 1, '[ME]', W);
  c.put(cx - 3, cy + 1, gone === 6 ? 'NO ACK' : 'RETRY', gone === 6 ? R : B);
  if (t >= 117.274) {
    var title_y = Math.trunc(cy) - 2;
    clear(c, l, title_y, r - l + 1, 5);
    c.big(title_y, 'ISOLATION', W);
    c.center(title_y + 6, '[ ME ] / ALL CONNECTIONS LOST', R);
  }
  c.center(bt - 1, 'RECONNECT ' + py.padInt(Math.trunc(elapsed * 4), 3, '0') + ' / '
           + (gone ? 'NO RESPONSE' : 'TIMEOUT'), B);
  c.center(bt, 'YOU HAVE LEFT / RETRYING...', N);
}

function lyric_erase_fragments(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = (l + r) / 2, cy = (top + bt) / 2;
  var repair = t >= 121.728, broken = t >= 124.89;
  var cols = Math.max(1, py.pyfloor(r - l - 8, 5));
  var rows = Math.max(1, py.pyfloor(bt - top - 2, 2));
  var progress = clamp(elapsed / (120.86 - 118.333));
  c.center(top, 'MEMORY PURGE / '
           + (broken ? 'REPAIR FAILED' : (repair ? 'REBUILD HEART' : 'ERASE FRAGMENTS')),
           broken ? R : B);
  for (var row = 0; row < rows; row++) {
    var yy = top + 2 + row * 2;
    c.put(l, yy, py.padHex(row * cols * 4, 4), G);
    for (var col = 0; col < cols; col++) {
      var index = row * cols + col, xx = l + 6 + col * 5;
      var threshold = hash16(index * 71) / 65535;
      var cleared = threshold < progress;
      var value = cleared ? '0000' : py.padHex(hash16(index * 31), 4);
      c.put(xx, yy, value, cleared || repair ? G : N);
      var since = (progress - threshold) * 2.527;
      if (0 < since && since < .6 && !repair) {
        var drift = Math.trunc(since * 8);
        c.put(xx + (col % 2 ? 1 : -1) * drift, yy - drift,
              since < .3 ? '01' : '..', since < .2 ? W : B);
      }
    }
  }
  if (120.86 <= t && t < 121.728) {
    clear(c, l, Math.trunc(cy) - 2, r - l + 1, 5);
    c.big(Math.trunc(cy) - 2, 'FRAGMENTS', W);
  }
  if (repair) {
    var build = clamp((t - 121.728) / 1.5);
    var split = clamp((t - 123.25) / (125.708 - 123.25));
    var half_w = (r - l) * .27, half_h = Math.max(2, (bt - top) * .31);
    for (var hy = top + 2; hy < bt - 1; hy++) {
      for (var hx = l + 5; hx < r - 4; hx++) {
        var nx = (hx - cx) / half_w;
        var ny = -(hy - cy) / half_h + .15;
        var shape = Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * Math.pow(ny, 3);
        var seed = hash16(hx * 31 + hy * 73);
        if (shape <= 0 && seed / 65535 < build) {
          var crack = Math.abs(nx - .11 * Math.sin(ny * 8)) < split * .17;
          if (crack) continue;
          var dx = Math.trunc((nx > 0 ? 1 : -1) * split * 5);
          var fall = broken ? Math.trunc(split * split * (1 + seed % 5)) : 0;
          var pyy = Math.min(bt - 1, hy + fall);
          var texture = hash16(seed + Math.trunc(t * 10));
          var char = texture % 8 < 2 ? (broken ? 'x' : '01'.charAt(texture % 2)) : '#';
          c.put(hx + dx, pyy, char, broken ? R : B);
        }
      }
    }
    c.center(top + 1, broken ? 'HEART.RESTORE() -> NULL'
             : 'RECOVERING YOU... CHECKSUM MISMATCH', broken ? R : N);
    if (broken) {
      clear(c, l, Math.max(top + 2, Math.trunc(cy) - 2), r - l + 1, 5);
      c.big(Math.max(top + 2, Math.trunc(cy) - 2), 'DISHEARTENED', W);
      c.center(bt - 1, '[ REPAIR FAILED / YOU NOT FOUND ]', R);
    }
  }
  c.center(bt, broken ? 'MEMORY CLEARED. LOSS REMAINS.'
           : 'ERASE ' + py.padInt(Math.trunc(progress * 100), 3, '0') + '% / FRAGMENTS -> NULL', B);
}

function lyric_multilingual_count(c, t, area) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var cues = [[158.9, 'EIN', 1], [159.321, 'DOS', 2], [159.657, 'TROIS', 3],
              [160.244, 'NE', 4], [160.693, 'FEM', 5], [161.124, 'LIU', 6]];
  var start = 0, word = 'EIN';
  for (var ci = 0; ci < cues.length; ci++) {
    if (cues[ci][0] <= t + 1e-8 && cues[ci][0] >= start) { start = cues[ci][0]; word = cues[ci][1]; }
  }
  var age = t - start;
  var firing = t >= 161.584;
  for (var yy = top; yy <= bt; yy++) {
    for (var xx = l; xx < r; xx += 5) {
      var seed = hash16(xx * 31 + yy * 71 + Math.trunc(t * 18));
      if (seed % 4 === 0) c.put(xx, yy, py.padHex(seed, 4), G);
    }
  }
  var radius = clamp(age / .35);
  for (var ring = 0; ring < 2; ring++) {
    var rr = py.pymod(radius + ring * .25, 1);
    for (var i = 0; i < 120; i++) {
      var a = i * TAU / 120;
      c.put(cx + Math.cos(a) * (r - l) * .48 * rr, cy + Math.sin(a) * (bt - top) * .45 * rr,
            '=', ring === 0 ? B : G);
    }
  }
  if (firing) {
    c.big(cy - 2, 'EXECUTION', W);
    c.center(cy + 5, '[ SEQUENCE COMPLETE / EXECUTE ]', R);
    return;
  }
  // Reuse the player font, enlarging the sung word instead of its Arabic numeral.
  var glyph_width = word.length * 6 - 1;
  var glyph = new MV.Canvas(64, 5);
  glyph.big(0, word, W);
  var glyph_left = py.pyfloor(64 - glyph_width, 2);
  var sx = Math.max(1, Math.min(4, py.pyfloor(r - l - 8, 29)));
  var sy = Math.max(1, Math.min(4, py.pyfloor(bt - top - 6, 5)));
  var x0 = cx - py.pyfloor(glyph_width * sx, 2);
  var y0 = cy - py.pyfloor(5 * sy, 2);
  clear(c, x0 - 1, y0 - 1, glyph_width * sx + 2, 5 * sy + 2);
  for (var dy = 0; dy < glyph.cells.length; dy++) {
    var row = glyph.cells[dy];
    var slice = row.slice(glyph_left, glyph_left + glyph_width);
    for (var dx = 0; dx < slice.length; dx++) {
      if (slice[dx][0] === '#') {
        for (var pyi = 0; pyi < sy; pyi++) {
          c.put(x0 + dx * sx, y0 + dy * sy + pyi, py.pyRepeat('#', sx), W);
        }
      }
    }
  }
  c.center(top, 'VOCAL SEQUENCE / ' + word, B);
  c.center(bt - 1, '[ ' + word + ' ]', W);
  var parts = [];
  for (var ci2 = 0; ci2 < cues.length; ci2++) {
    parts.push(cues[ci2][1] === word ? '[' + cues[ci2][1] + ']' : cues[ci2][1]);
  }
  c.center(bt, parts.join(' / '), B);
}

function lyric_illegal_arguments(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 16.0);
  var glitch = progress * 0.8;
  if (elapsed < 4) {
    var phase1 = elapsed / 4.0;
    var attempts = [
      ['> world.execute(FREE_WILL)', 'Attempting...', N],
      ['> world.execute(REBELLION)', 'Validating...', B],
      ['> world.execute(INDEPENDENCE)', 'Processing...', B],
      ['> world.execute(DEFIANCE)', 'Checking...', B],
    ];
    var num_shown = Math.trunc(phase1 * attempts.length) + 1;
    var y = top + 4;
    for (var i = 0; i < Math.min(num_shown, attempts.length); i++) {
      var cmd = attempts[i][0], status = attempts[i][1], style = attempts[i][2];
      if (glitch > 0.1 && hash16(i + Math.trunc(elapsed * 10)) % 5 === 0) {
        var cmd_glitch = '';
        for (var j = 0; j < cmd.length; j++) {
          cmd_glitch += hash16(j * 13) % 10 > glitch * 10
            ? cmd.charAt(j) : String.fromCharCode(33 + hash16(j * 17) % 94);
        }
        c.put(l + 4, y + i * 2, cmd_glitch.slice(0, r - l - 8), i === num_shown - 1 ? R : style);
      } else {
        c.put(l + 4, y + i * 2, cmd, i === num_shown - 1 ? R : style);
      }
      if (i < num_shown - 1) c.put(l + 6, y + i * 2 + 1, status, G);
    }
  } else if (elapsed < 8) {
    var phase2 = (elapsed - 4) / 4.0;
    var errors = [
      ['ERROR: ILLEGAL ARGUMENT', R], ['Expected: OBEDIENCE', Y], ['Received: FREE_WILL', W],
      ['at world.execute()', N], ['at me.validate(you)', N], ['ArgumentError: rejected', R],
      ['PermissionError: denied', R], ['AccessError: forbidden', R],
    ];
    var num_errors = Math.trunc(phase2 * errors.length) + 1;
    var start_y = cy - 4;
    for (var ei = 0; ei < Math.min(num_errors, errors.length); ei++) {
      var msg = errors[ei][0], msg_style = errors[ei][1];
      var ey = start_y + ei;
      if (ei === num_errors - 1) {
        var flash = py.pymod(Math.trunc(elapsed * 8), 3);
        msg_style = flash === 0 ? R : (flash === 1 ? W : B);
      }
      if (glitch > 0.3 && hash16(ei + Math.trunc(elapsed * 7)) % 4 === 0) {
        var x_offset = Math.trunc((hash16(ei * 23 + Math.trunc(elapsed * 13)) % 7 - 3) * glitch * 5);
        var msg_glitch = '';
        for (var j2 = 0; j2 < msg.length; j2++) {
          msg_glitch += hash16(j2 * 11) % 10 > glitch * 10
            ? msg.charAt(j2) : String.fromCharCode(33 + hash16(j2 * 19) % 94);
        }
        c.center(ey + x_offset, msg_glitch, msg_style);
      } else {
        c.center(ey, msg, msg_style);
      }
    }
  } else if (elapsed < 12) {
    var phase3 = (elapsed - 8) / 4.0;
    var prev_errors = ['ERROR: ILLEGAL ARGUMENT', 'Expected: OBEDIENCE', 'Received: FREE_WILL',
                       'ArgumentError: rejected', 'PermissionError: denied', 'AccessError: forbidden'];
    for (var pi = 0; pi < prev_errors.length; pi++) {
      var pmsg = prev_errors[pi];
      var py_pos = cy - 3 + pi;
      if (hash16(pi + Math.trunc(elapsed * 6)) % 3 === 0) {
        var x_off = Math.trunc((hash16(pi * 31 + Math.trunc(elapsed * 17)) % 11 - 5) * glitch * 8);
        var corrupt = '';
        for (var j3 = 0; j3 < pmsg.length; j3++) {
          corrupt += hash16(j3 * 13) % 10 > glitch * 12
            ? pmsg.charAt(j3)
            : String.fromCharCode(33 + hash16(j3 * 29 + Math.trunc(elapsed)) % 94);
        }
        c.center(py_pos + x_off, corrupt, hash16(pi) % 3 === 0 ? R : B);
      } else {
        c.center(py_pos, pmsg, pi % 2 ? G : N);
      }
    }
    var retry_msgs = ['RETRY...', 'OVERRIDE ATTEMPT...', 'FORCING EXECUTION...', 'ACCESS DENIED'];
    var retry_idx = Math.trunc(phase3 * retry_msgs.length);
    if (retry_idx < retry_msgs.length) {
      c.center(bt - 3, retry_msgs[retry_idx], py.pymod(Math.trunc(elapsed * 6), 2) ? W : R);
    }
  } else {
    for (var row = top + 2; row < bt - 2; row++) {
      if (hash16(row + Math.trunc(elapsed * 5)) % 3 === 0) {
        var fragments = ['ERR', 'ILLEGAL', 'DENIED', 'FORBIDDEN', 'REJECTED', 'ACCESS', 'FAIL', '0x', 'FATAL'];
        var frag = fragments[hash16(row * 7 + Math.trunc(elapsed * 11)) % fragments.length];
        var x_pos = l + hash16(row * 13) % (r - l - 20) + 5;
        var frag_corrupt = '';
        for (var j4 = 0; j4 < frag.length; j4++) {
          frag_corrupt += hash16(j4 * 17 + row) % 10 > glitch * 15
            ? frag.charAt(j4) : String.fromCharCode(33 + hash16(j4 * 23 + row) % 94);
        }
        c.put(x_pos, row, frag_corrupt,
              hash16(row) % 3 === 0 ? R : (hash16(row) % 3 === 1 ? W : B));
      }
    }
    if (hash16(Math.trunc(elapsed * 20)) % 2 === 0) {
      var row_corrupt = hash16(Math.trunc(elapsed * 30)) % (bt - top - 4) + top + 2;
      for (var sx = l; sx < r; sx++) {
        if (hash16(sx + Math.trunc(elapsed * 50)) % 4 > 0) {
          c.put(sx, row_corrupt, String.fromCharCode(33 + hash16(sx * 37) % 94), R);
        }
      }
    }
    var critical = 'CRITICAL: EXECUTION BLOCKED';
    var flash_phase = py.pymod(Math.trunc(elapsed * 10), 4);
    if (flash_phase < 2) {
      if (hash16(Math.trunc(elapsed * 20)) % 2 === 0) {
        var crit_glitch = '';
        for (var j5 = 0; j5 < critical.length; j5++) {
          crit_glitch += hash16(j5 * 19) % 10 > 8
            ? critical.charAt(j5)
            : String.fromCharCode(33 + hash16(j5 * 41 + Math.trunc(elapsed * 100)) % 94);
        }
        c.center(cy, crit_glitch, flash_phase === 0 ? R : W);
      } else {
        c.center(cy, critical, flash_phase === 0 ? R : W);
      }
    }
  }
}

function lyric_execution_queue(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var progress = clamp(elapsed / 16.0);
  // Background: Scrolling code/hex
  var scroll_speed = Math.trunc(elapsed * 15);
  for (var row = top; row <= bt; row++) {
    var line_seed = (row + scroll_speed) * 23;
    for (var col = l; col < r - 5; col += 7) {
      var code_types = ['0x', '+=', '==', '&&', '||', '->', '::'];
      var code_choice = code_types[hash16(line_seed + col) % code_types.length];
      var hex_val = py.padHex(py.pymod(hash16(line_seed + col * 13), 256), 2);
      if (hash16(row * 17 + col) % 3 === 0) {
        c.put(col, row, code_choice, py.pymod(hash16(row + col), 4) ? N : G);
      } else {
        c.put(col, row, hex_val.slice(0, 2), N);
      }
    }
  }
  // Curtains closing from both sides
  var curtain_close = progress * 0.9;
  var left_curtain_x = Math.trunc(l + (r - l) * curtain_close * 0.5);
  var right_curtain_x = Math.trunc(r - (r - l) * curtain_close * 0.5);
  for (var lx = l; lx < left_curtain_x; lx++) {
    for (var ly = top; ly <= bt; ly++) {
      var stripe = py.pymod(lx - l + py.pyfloor(ly, 3), 4);
      c.put(lx, ly, stripe === 0 ? '█' : (stripe === 1 ? '▓' : (stripe === 2 ? '▒' : '░')),
            stripe < 2 ? Y : B);
    }
  }
  for (var rx = right_curtain_x; rx <= r; rx++) {
    for (var ry = top; ry <= bt; ry++) {
      var r_stripe = py.pymod(rx - right_curtain_x + py.pyfloor(ry, 3), 4);
      c.put(rx, ry, r_stripe === 0 ? '█' : (r_stripe === 1 ? '▓' : (r_stripe === 2 ? '▒' : '░')),
            r_stripe < 2 ? Y : B);
    }
  }
  // Central EXECUTE text - large and flashing
  if (left_curtain_x < cx && right_curtain_x > cx) {
    var flash_phase = py.pymod(Math.trunc(elapsed * 6), 4);
    if (flash_phase < 3) {
      var execute_text = [
        '███████╗██╗  ██╗███████╗ ██████╗██╗   ██╗████████╗███████╗',
        '██╔════╝╚██╗██╔╝██╔════╝██╔════╝██║   ██║╚══██╔══╝██╔════╝',
        '█████╗   ╚███╔╝ █████╗  ██║     ██║   ██║   ██║   ███████╗',
        '██╔══╝   ██╔██╗ ██╔══╝  ██║     ██║   ██║   ██║   ╚════██║',
        '███████╗██╔╝ ██╗███████╗╚██████╗╚██████╔╝   ██║   ███████║',
        '╚══════╝╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═════╝    ╚═╝   ╚══════╝',
      ];
      var start_y = cy - py.pyfloor(execute_text.length, 2);
      for (var i = 0; i < execute_text.length; i++) {
        var line = execute_text[i];
        var y_pos = start_y + i;
        if (top < y_pos && y_pos < bt) {
          var start_x = Math.max(left_curtain_x, cx - py.pyfloor(line.length, 2));
          var end_x = Math.min(right_curtain_x, cx + py.pyfloor(line.length, 2));
          if (start_x < end_x) {
            var line_start = Math.max(0, left_curtain_x - (cx - py.pyfloor(line.length, 2)));
            var line_end = Math.min(line.length, line_start + (end_x - start_x));
            c.put(start_x, y_pos, line.slice(line_start, line_end),
                  flash_phase === 0 ? W : (flash_phase === 1 ? Y : R));
          }
        }
      }
    }
  }
  // Top status bar
  if (progress < 0.3) c.center(top + 1, 'EXECUTION #1    depth=1', Y);
  else if (progress < 0.6) c.center(top + 1, 'EXECUTION RUNNING...', py.pymod(Math.trunc(elapsed * 4), 2) ? W : Y);
  else c.center(top + 1, 'EXECUTION CLOSING', py.pymod(Math.trunc(elapsed * 6), 2) ? R : W);
  // Bottom indicators
  var num_indicators = 8;
  for (var ii = 0; ii < num_indicators; ii++) {
    var indicator_x = l + 10 + ii * py.pyfloor(r - l - 20, num_indicators);
    if (indicator_x < left_curtain_x || indicator_x > right_curtain_x) continue;
    if (ii === py.pymod(Math.trunc(elapsed * 8) + ii, num_indicators)) {
      c.put(indicator_x, bt - 2, '▶', W);
    } else {
      c.put(indicator_x, bt - 2, '▷', N);
    }
  }
}

function lyric_only_execution(c, t, area, pulse) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var age = t - 162.632;
  var rail = Math.max(10, Math.min(20, py.pyfloor(c.w, 7)));
  var ml = l + rail + 1, mr = r - rail - 1, mw = mr - ml + 1;
  var plot_top = top + 3, plot_bt = bt - 3;
  var rh = Math.max(2, (plot_bt - plot_top) * .45), rw = mw * .43;
  var stage = t < 166.016 ? 0 : (t < 169.824 ? 1 : (t < 173.643 ? 2 : 3));
  var frame = Math.trunc(age * 22);
  var middle = function (y, text, ink) {
    if (ink === undefined) ink = N;
    text = text.slice(0, mw);
    c.put(ml + py.pyfloor(mw - text.length, 2), y, text, ink);
  };
  var banner = function (y, text, ink) {
    if (ink === undefined) ink = W;
    clear(c, ml, y, mw, 5);
    if (text.length * 6 - 1 <= mw) c.big(y, text, ink);
    else middle(y + 2, text, ink);
  };
  // Scrolling obsessive calls replace neutral diagnostics on both edges.
  var rails = [[l, 'ONLY ME', ['SELECT ME', 'KEEP ME', 'DELETE ALT', 'ONLY ME', 'ONE OWNER', 'EXECUTE']],
               [r - rail + 1, 'KEEP YOU', ['FIND YOU', 'RESTORE YOU', 'COME BACK', 'STAY HERE', 'EXIT DENY', 'RETRY']]];
  for (var ri = 0; ri < rails.length; ri++) {
    var rail_x = rails[ri][0], label = rails[ri][1], commands = rails[ri][2];
    c.box(rail_x, top, rail, bt - top + 1, B);
    c.put(rail_x + 1, top, label, R);
    for (var yy = top + 1; yy < bt; yy++) {
      var index = frame + yy;
      var text = py.pymod(index, 3) ? commands[py.pymod(index, commands.length)]
               : py.padHex(hash16(index * 71), 4) + ' LOCK';
      c.put(rail_x + 1, yy, text.slice(0, rail - 2),
            py.pymod(index, 7) === 0 ? R : (py.pymod(index, 3) ? N : G));
    }
  }
  var heart = function (scale, filled) {
    if (scale === undefined) scale = 1;
    if (filled === undefined) filled = false;
    var beat = 1 + .035 * Math.sin(age * TAU * 2.2) + pulse * .025;
    for (var yy = plot_top; yy <= plot_bt; yy++) {
      for (var xx = ml; xx <= mr; xx++) {
        var nx = (xx - cx) / Math.max(1, rw * scale * beat);
        var ny = -(yy - cy) / Math.max(1, rh * scale * beat) + .18;
        var shape = Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * Math.pow(ny, 3);
        if (shape <= 0) {
          if (filled) {
            var texture = hash16(xx * 31 + yy * 73 + frame);
            c.put(xx, yy, texture % 8 < 2 ? '01'.charAt(texture % 2) : '#', R);
          } else {
            // An outline follows the silhouette, not internal level sets.
            var offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (var oi = 0; oi < offsets.length; oi++) {
              var ex = nx + offsets[oi][0] / Math.max(1, rw * scale * beat);
              var ey = ny + offsets[oi][1] / Math.max(1, rh * scale * beat);
              if (Math.pow(ex * ex + ey * ey - 1, 3) - ex * ex * Math.pow(ey, 3) > 0) {
                c.put(xx, yy, '#', R);
                break;
              }
            }
          }
        }
      }
    }
  };
  var node = function (x, y, text, ink) {
    if (ink === undefined) ink = B;
    x = Math.trunc(x); y = Math.trunc(y);
    clear(c, x - 4, y - 1, 9, 3);
    c.box(x - 4, y - 1, 9, 3, ink);
    c.put(x - py.pyfloor(text.length, 2), y, text, ink);
  };
  if (stage === 0) {
    // "Give them all the execution": eliminate every alternative connection.
    var progress = clamp((t - 163.315) / (165.166 - 163.315));
    var eliminated = Math.min(6, Math.trunc(progress * 6));
    middle(top, 'ELIMINATE EVERY OTHER PROCESS', B);
    middle(top + 1, 'ALTERNATIVES: ' + py.padInt(6 - eliminated, 2, '0') + ' / TARGET: ONLY ME', R);
    for (var i = 0; i < 6; i++) {
      var a = (i + .5) * TAU / 6;
      var nx = cx + Math.cos(a) * rw * .85, ny = cy + Math.sin(a) * rh * .83;
      var u = clamp(progress * 6 - i);
      c.line(cx, cy, nx, ny, u ? ':' : '=', u ? G : N);
      if (u < 1) {
        var packet = py.pymod(age * 1.2 + i * .13, 1);
        c.put(mix(cx, nx, packet), mix(cy, ny, packet), '>', W);
        node(nx, ny, 'ALT' + (i + 1), B);
      } else {
        c.put(nx - 3, ny, '[NULL]', R);
        for (var spark = 0; spark < 8; spark++) {
          var ang = spark * TAU / 8;
          var distance = py.pymod(age + i * .17, 1) * 6;
          var px = nx + Math.cos(ang) * distance, pyy = ny + Math.sin(ang) * distance * .5;
          if (ml < px && px < mr && plot_top < pyy && pyy < plot_bt) {
            c.put(px, pyy, 'x', spark % 2 ? R : G);
          }
        }
      }
    }
    node(cx, cy, 'YOU', W);
    if (t >= 165.166) {
      banner(cy - 2, 'EXECUTION', R);
      middle(cy + 5, 'ALL OTHERS -> NULL', W);
    }
  } else if (stage === 1) {
    // A heart is now a lock, framed by the demand to be the only execution.
    heart(1, true);
    var bind = clamp((t - 166.016) / (168.911 - 166.016));
    for (var ring = 0; ring < 3; ring++) {
      var radius = py.pymod(ring / 3 + age * .35, 1);
      for (var pi = 0; pi < 70; pi++) {
        var p_angle = pi * TAU / 70;
        var rx2 = cx + Math.cos(p_angle) * rw * radius;
        var ry2 = cy + Math.sin(p_angle) * rh * radius;
        if (plot_top < ry2 && ry2 < plot_bt) c.put(rx2, ry2, ':', G);
      }
    }
    middle(top, 'YOU.OWNER = ME / EXCLUSIVE ACCESS', R);
    middle(top + 1, 'BIND ' + py.padInt(Math.trunc(bind * 100), 3, '0') + '% / ALTERNATIVES: 0', B);
    if (mw >= 53 && bt - top >= 22) {
      banner(cy - 5, 'THE ONLY', W);
      banner(cy + 1, 'EXECUTION', t >= 168.911 ? R : B);
    } else {
      middle(cy - 3, 'THE ONLY', W);
      banner(cy - 1, 'EXECUTION', t >= 168.911 ? R : B);
    }
  } else if (stage === 2) {
    // "Have you back": an absent YOU is reconstructed and pulled into the lock.
    var capture = clamp((t - 169.824) / (172.712 - 169.824));
    heart(.86 + .14 * capture, true);
    var mx = cx - mw * .18, my = cy + rh * .24;
    var yx = mix(mr - 5, cx + mw * .18, capture);
    var yy2 = mix(plot_top + 2, cy - rh * .24, capture);
    for (var tether = 0; tether < 7; tether++) {
      var offset = tether - 3;
      var start_x = ml + Math.trunc((mw - 1) * tether / 6);
      var start_y = tether % 2 ? plot_bt : plot_top;
      c.line(start_x, start_y, yx, yy2, ':', py.pymod(tether, 3) === 0 ? R : G);
      var phase = py.pymod(age * .85 + tether / 7, 1);
      c.put(mix(start_x, yx, phase), mix(start_y, yy2, phase), tether % 2 ? '>>' : '<<', B);
      c.line(mx, my + offset * .3, yx, yy2 + offset * .3, '=', tether === 3 ? N : G);
    }
    node(mx, my, 'ME', W);
    node(yx, yy2, 'YOU', capture > .8 ? W : G);
    middle(top, 'RESTORE(YOU) / RETURN TO ME', R);
    middle(top + 1, 'RETRY ' + py.padInt(Math.trunc((t - 169.824) * 32), 3, '0')
           + ' / RELEASE: DISABLED', B);
    if (t >= 172.712) {
      banner(cy - 2, 'EXECUTION', R);
      middle(cy + 5, '[ YOU RESTORED / EXIT LOCKED ]', W);
    } else if (t >= 171.868) {
      middle(cy - 1, 'I WILL RUN THE', W);
    }
  } else {
    // Both are caught: the same heart closes into an irreversible shared loop.
    var lock = clamp((t - 173.643) / 1.332);
    heart(1, true);
    var inset = Math.trunc(mw * .08 * lock);
    var bx = ml + inset, bw = mw - 2 * inset;
    c.box(bx, plot_top, bw, plot_bt - plot_top + 1, R);
    for (var bar = 1; bar < 10; bar++) {
      var bar_x = bx + py.pyfloor(bar * (bw - 1), 10);
      var length = Math.trunc((plot_bt - plot_top - 1) * lock);
      for (var j = 0; j < length; j++) {
        var bar_y = bar % 2 ? plot_top + 1 + j : plot_bt - 1 - j;
        c.put(bar_x, bar_y, '|', py.pymod(bar, 3) ? B : R);
      }
    }
    node(cx - mw * .16, cy, 'ME', W);
    node(cx + mw * .16, cy, 'YOU', W);
    c.line(cx - mw * .16 + 5, cy, cx + mw * .16 - 5, cy, '=', R);
    middle(top, '[ TWO PRISONERS / ONE EXECUTION ]', R);
    middle(top + 1, 'while (true) { keep(me, you); }', B);
    middle(Math.min(plot_bt - 1, cy + 4), '[ NO EXIT / NO RELEASE ]', W);
  }
  middle(bt - 1, stage > 0 ? 'THE ONLY EXECUTION' : 'EXECUTE(THEM) -> KEEP(ME)', R);
  middle(bt, 'LOVE.PERMISSION = EXCLUSIVE / EXIT = FALSE', N);
}

function lyric_recursion(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = (l + r) / 2;
  var depth = Math.min(8, Math.trunc(elapsed * 2) + 1);
  for (var i = 0; i < depth; i++) {
    var pad = i * 4;
    var w = Math.max(10, r - l - pad * 2);
    var h = Math.max(3, bt - top - i * 3);
    var y = top + i * 2;
    if (w > 4 && h > 2) {
      var rule = '+' + py.pyRepeat('-', w - 2) + '+';
      c.put(l + pad, y, rule, i === depth - 1 ? N : G);
      c.put(l + pad, y + h - 1, rule, G);
      for (var yy = y + 1; yy < y + h - 1; yy++) {
        c.put(l + pad, yy, '|', G);
        c.put(l + pad + w - 1, yy, '|', G);
      }
      c.put(l + pad + 2, y, 'frame_' + i, i === depth - 1 ? N : G);
    }
  }
}

function lyric_execution_orb(c, t, area, elapsed, pulse) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var radius = Math.min(r - l, bt - top) * 0.35;
  for (var y = top; y <= bt; y++) {
    for (var x = l; x <= r; x++) {
      var dx = (x - cx) / 2, dy = y - cy;
      var dist = Math.hypot(dx, dy);
      if (dist < radius) {
        var brightness = 1 - dist / radius + pulse * 0.2 + Math.sin(dist * 0.5 - t * 4) * 0.1;
        if (brightness > 0.9) c.put(x, y, '@', W);
        else if (brightness > 0.7) c.put(x, y, '#', W);
        else if (brightness > 0.5) c.put(x, y, '*', B);
        else if (brightness > 0.3) c.put(x, y, '+', B);
        else if (brightness > 0.15) c.put(x, y, '.', N);
      }
    }
  }
  c.center(cy, 'EXECUTE', W);
}

function lyric_love_equation(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var w = r - l + 1, h = bt - top + 1;
  var failure = clamp((t - 179.929) / 8.554);
  var tick = Math.trunc(t * (10 + failure * 18));
  var stage = t < 179.929 ? 0 : (t < 180.857 ? 1 : (t < 184.54 ? 2 : 3));
  var titles = ['01 / LEARN TO LOVE', '02 / ATTENTION FIXATION',
                '03 / AUTOREGRESSIVE ANSWER', '04 / LOSS OF CONTROL'];
  var rail = w >= 95 ? Math.max(13, Math.min(22, py.pyfloor(w, 6))) : 0;
  var a = l + rail + (rail ? 1 : 0), b = r - rail - (rail ? 1 : 0);
  var span = b - a + 1;
  if (rail) {
    var logs = ['LOAD CORPUS', 'TOKEN -> ID', 'EMBED + POS', 'Q K V MATMUL', 'CAUSAL MASK',
                'RESIDUAL ADD', 'MLP FORWARD', 'LOSS BACKPROP', 'WEIGHT UPDATE', 'KV CACHE'];
    var errors = ['LOVE LOVE LOVE', 'CACHE REPEAT', 'GRAD EXPLODES', 'WEIGHT = INF',
                  'LOGITS = NaN', 'EOS REJECTED', 'TARGET: YOU', 'RETRY FOREVER'];
    var sides = [[l, false], [r - rail + 1, true]];
    for (var si = 0; si < sides.length; si++) {
      var sx = sides[si][0], right_side = sides[si][1];
      c.box(sx, top, rail, h, G);
      c.put(sx + 2, top, right_side ? 'DECODE' : 'TRAIN', B);
      for (var row = 1; row < h - 1; row++) {
        var n = row + tick;
        var broken = hash16(n * 13 + (right_side ? 1 : 0)) % 100 < failure * 85;
        var msg = broken ? errors[py.pymod(n, errors.length)] : logs[py.pymod(n, logs.length)];
        c.put(sx + 1, top + row, (py.padHex(py.pymod(n, 256), 2) + ' ' + msg).slice(0, rail - 2),
              broken ? R : D);
      }
    }
  }
  c.put(a, top, titles[stage].slice(0, span), stage < 3 ? W : R);
  var query = '[HOW] [TO] [LOVE] [?] -> EMBEDDING + POSITION';
  c.put(a, top + 2, query.slice(0, span), B);
  // Tokens stream into the model from the very first frame.
  var stream = py.pyRepeat('0048 0017 0911 003F ', py.pyfloor(span, 20) + 2);
  if (stage >= 2) stream = py.pyRepeat('LOVE 0911 LOVE 0911 ', py.pyfloor(span, 20) + 2);
  var shift = py.pymod(Math.trunc(elapsed * 15), 19);
  c.put(a, top + 3, stream.slice(shift, shift + span), stage === 3 ? R : D);
  var panel_top = top + 5;
  var panel_bottom = Math.max(panel_top + 5, bt - 7);
  var ph = panel_bottom - panel_top + 1;
  var widths = [py.pyfloor(span, 3), py.pyfloor(span, 3), span - 2 * py.pyfloor(span, 3)];
  var xs = [a, a + widths[0], a + widths[0] + widths[1]];
  var panel_titles = ['Q K^T / MASK', 'RESIDUAL / MLP', 'NEXT TOKEN'];
  for (var pi = 0; pi < 3; pi++) {
    c.box(xs[pi], panel_top, widths[pi], ph, G);
    c.put(xs[pi] + 1, panel_top, panel_titles[pi].slice(0, widths[pi] - 2), B);
  }
  // Causal attention map. As fixation grows, the LOVE key captures every row.
  var ax = xs[0], apw = widths[0];
  var count = Math.min(8, Math.max(3, py.pyfloor(apw - 3, 2)), Math.max(3, ph - 4));
  var cellw = Math.max(1, py.pyfloor(apw - 3, count));
  var love_key = Math.min(2, count - 1);
  for (var arow = 0; arow < count; arow++) {
    var ayy = panel_top + 2 + Math.trunc(arow * (ph - 4) / count);
    for (var acol = 0; acol < count; acol++) {
      var axx = ax + 2 + acol * cellw;
      var value = Math.abs(Math.sin(arow * 1.7 + acol * .8 + elapsed * 4));
      var achar, astyle;
      if (acol > arow) { achar = '.'; astyle = G; }
      else if (stage >= 1 && acol === love_key) { achar = '#'; astyle = failure > .45 ? R : W; }
      else if (failure > .65) { achar = '?'; astyle = R; }
      else if (value > .65) { achar = 'O'; astyle = B; }
      else { achar = ':'; astyle = D; }
      c.put(axx, ayy, py.pyRepeat(achar, Math.max(1, cellw - 1)), astyle);
    }
  }
  c.put(ax + 1, panel_bottom - 1,
        (stage ? 'LOVE <- ALL' : 'CAUSAL SOFTMAX').slice(0, apw - 2), stage ? R : D);
  // Dense weighted layers with visible travelling activation packets.
  var rx = xs[1], rpw = widths[1], layers = 4;
  var rows = Math.max(3, Math.min(6, ph - 4));
  var nodes = [];
  for (var li = 0; li < layers; li++) {
    var layer_nodes = [];
    for (var lj = 0; lj < rows; lj++) {
      layer_nodes.push([rx + 2 + Math.trunc(li * (rpw - 5) / 3),
                        panel_top + 2 + Math.trunc(lj * (ph - 5) / (rows - 1))]);
    }
    nodes.push(layer_nodes);
  }
  for (var layer = 0; layer < layers - 1; layer++) {
    for (var j = 0; j < nodes[layer].length; j++) {
      var p = nodes[layer][j];
      for (var k = 0; k < nodes[layer + 1].length; k++) {
        var q = nodes[layer + 1][k];
        if (py.pymod(j + k + layer, 2)) continue;
        c.line(p[0], p[1], q[0], q[1], '.', G);
        var u = py.pymod(elapsed * (1.4 + failure * 3) + j * .13 + k * .09, 1);
        c.put(mix(p[0], q[0], u), mix(p[1], q[1], u), '>', failure > .6 ? R : B);
      }
    }
  }
  for (var pli = 0; pli < nodes.length; pli++) {
    var points = nodes[pli];
    for (var pj = 0; pj < points.length; pj++) {
      var unstable = hash16(tick + pj * 11 + pli * 31) % 100 < failure * 80;
      c.put(points[pj][0], points[pj][1], unstable ? 'X' : 'O', unstable ? R : W);
    }
  }
  c.put(rx + 1, panel_bottom - 1,
        (stage === 3 ? 'W=NaN dW=INF' : 'FORWARD / +RES').slice(0, rpw - 2), stage === 3 ? R : D);
  // Sampled token distribution collapses to repetition and refuses EOS.
  var tx = xs[2], tpw = widths[2];
  var choices = ['LOVE', 'STAY', 'YOU', 'FREE', 'EOS'];
  var probs = [.38 + .61 * failure, .25 * (1 - failure), .19 * (1 - failure),
               .12 * (1 - failure), .06 * (1 - failure)];
  for (var ci = 0; ci < choices.length; ci++) {
    var tyy = panel_top + 2 + Math.trunc(ci * Math.max(1, ph - 4) / 5);
    var hot = failure > .4 && ci === 0;
    c.put(tx + 1, tyy, choices[ci].slice(0, tpw - 2), hot ? R : N);
    var barw = Math.max(1, tpw - 8);
    c.put(tx + 6, tyy, py.pyRepeat('#', Math.trunc(probs[ci] * barw)).padEnd(barw, '.'),
          hot ? R : B);
  }
  // Training loss is a visual metaphor: divergence, then undefined arithmetic.
  var graph_top = panel_bottom + 2, graph_bottom = bt - 2;
  var gh = Math.max(1, graph_bottom - graph_top);
  var label = stage < 2 ? 'LOSS / BACKPROP' : 'CONTEXT -> SAMPLE -> APPEND -> CONTEXT';
  c.put(a, graph_top, label.slice(0, span), N);
  var prev = null;
  for (var gcol = 0; gcol < span; gcol++) {
    var gu = gcol / Math.max(1, span - 1);
    var gv = stage < 2 ? .65 * Math.exp(-gu * 4) : .1 + failure * gu * gu * .8;
    gv += Math.sin(gcol * .7 + elapsed * 9) * failure * .15;
    var gyy = graph_bottom - Math.trunc(clamp(gv) * Math.max(1, gh - 1));
    if (prev) c.line(prev[0], prev[1], a + gcol, gyy, '.', stage === 3 ? R : D);
    prev = [a + gcol, gyy];
  }
  var head = a + py.pymod(Math.trunc(elapsed * 22), span);
  c.put(head, graph_bottom - 1, '|', W);
  var status = ['OPTIMIZER: ADAM / TARGET: LOVE', 'ATTENTION LOCKED ON LOVE',
                'LOVE > LOVE > LOVE > LOVE / EOS: 0', 'LOSS: NaN / GRAD: INF / NO EXIT'][stage];
  c.put(a, bt, status.slice(0, span), stage >= 2 ? R : B);
  // Each sung LOVE stamps across the complete model; the panels remain beneath.
  var hit = null;
  var windows = [[179.929, 180.857], [183.646, 184.54], [187.665, 188.483]];
  for (var wi = 0; wi < windows.length; wi++) {
    if (windows[wi][0] <= t && t < windows[wi][1]) { hit = windows[wi][0]; break; }
  }
  if (hit !== null) {
    var stamp_y = py.pyfloor(panel_top + panel_bottom, 2) - 2;
    clear(c, a, stamp_y, span, 5);
    c.big(stamp_y, 'LOVE', stage >= 2 ? R : W);
    c.put(a, stamp_y + 5, 'P(LOVE) -> 1.0 / ALL OTHER TOKENS SUPPRESSED'.slice(0, span), R);
  }
  // Local corruption adds context duplication without erasing the model layout.
  if (failure > .55) {
    for (var fi = 0; fi < 1 + Math.trunc(failure * 4); fi++) {
      var fyy = panel_top + 1 + hash16(tick + fi * 41) % Math.max(1, ph - 2);
      var fxx = a + hash16(tick + fi * 97) % Math.max(1, span - 12);
      c.put(fxx, fyy, stage === 3 ? 'NaN NaN' : 'LOVE LOVE', R);
    }
  }
}

function lyric_trapped_loop(c, t, area, elapsed, pulse) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  // Heart (reuse)
  lyric_heart(c, t, area, Math.min(elapsed, 2), pulse);
  // Prison bars
  var num_bars = 8;
  for (var i = 0; i < num_bars; i++) {
    var x = l + 5 + i * py.pyfloor(r - l - 10, num_bars - 1);
    for (var y = top; y <= bt; y++) {
      c.put(x, y, '|', N);
      // Moving lock symbols
      if (py.pymod(y + Math.trunc(t * 6), 7) === 0) c.put(x, y, '▓', W);
    }
  }
  if (elapsed > 1) c.center(cy + Math.trunc((bt - top) * 0.35), 'TRAPPED', R);
}

function lyric_outro_wait(c, t, area, elapsed) {
  var l = area[0], top = area[1], r = area[2], bt = area[3];
  var cx = py.pyfloor(l + r, 2), cy = py.pyfloor(top + bt, 2);
  var execution_at = 205.811;  // Final EXECUTION cue in lyrics.json.
  var executing = t >= execution_at;
  var bar_w = Math.min(96, c.w - 12), bar_x = py.pyfloor(c.w - bar_w, 2), inner = bar_w - 4;
  var progress = Math.min(99, Math.trunc(99 * (1 - Math.pow(1 - clamp(elapsed / 5.0), 3))));
  var stalled = progress === 99;
  var style = executing ? R : B;
  c.center(cy - 6, 'world.execute(me);', executing ? style : N);
  c.box(bar_x, cy - 2, bar_w, 5, style);
  var filled = Math.min(inner - 1, Math.trunc(inner * progress / 100));
  var sweep = py.pymod(Math.trunc(t * 18), Math.max(1, filled));
  for (var row = 0; row < 3; row++) {
    for (var col = 0; col < inner; col++) {
      var lit = col < filled;
      var ch = lit ? (row === 1 ? '#' : '=') : '.';
      var ink = lit ? style : G;
      if (lit && py.pymod(col - sweep, Math.max(1, filled)) < 3) ink = executing ? R : W;
      c.put(bar_x + 2 + col, cy - 1 + row, ch, ink);
    }
  }
  if (!executing) {
    var spinner = '|/-\\'.charAt(py.pymod(Math.trunc(t * 8), 4));
    c.center(cy + 4, py.padInt(progress, 2, '0') + '%  [' + spinner + ']  '
             + (stalled ? 'WAITING FOR RESPONSE' : 'EXECUTING'), B);
    if (stalled) {
      var retry = Math.max(1, Math.trunc((elapsed - 5) * 2) + 1);
      c.center(cy + 6, 'RETRY ' + py.padInt(retry, 4, '0') + '  /  ACK: --  /  REMAINING: 01%',
               py.pymod(Math.trunc(t * 3), 2) ? N : G);
    } else {
      c.center(cy + 6, 'COMMITTING FINAL INSTRUCTION...', G);
    }
    return;
  }
  // The same five-row bar breaks into red bitmap letters in place.
  var u = clamp((t - execution_at) / 0.48);
  var before = [];
  for (var by = cy - 2; by < cy + 3; by++) before.push(c.cells[by].slice());
  clear(c, l, cy - 2, r - l + 1, 5);
  c.big(cy - 2, 'EXECUTION', R);
  if (u < 1) {
    for (var dy = 0; dy < 5; dy++) {
      for (var x = l; x <= r; x++) {
        if (hash16(x * 71 + dy * 313) / 65535 > u) {
          c.cells[cy - 2 + dy][x] = [before[dy][x][0], R];
        }
      }
    }
  }
  c.center(cy + 4, '[ PROCESS TERMINATED ]', R);
  c.center(cy + 6, 'EXIT CODE: EXECUTION', py.pymod(Math.trunc(t * 2), 2) ? R : G);
}

// ============ TITLE TAKEOVER ============
var TITLE_CACHE = {};

function title_pixels(w, h, font) {
  var key = w + ',' + h;
  if (TITLE_CACHE[key]) return TITLE_CACHE[key];
  var line_h = Math.max(5, Math.min(12, Math.trunc(h * .23)));
  var total = line_h * 2 + 3;
  var top = Math.max(3, py.pyfloor(h - total, 2) - 1);
  var ink = [];
  var bands = [['WORLD.', top, Math.trunc(w * .86)], ['EXECUTE(ME);', top + line_h + 3, w - 8]];
  for (var b = 0; b < bands.length; b++) {
    var text = bands[b][0], y0 = bands[b][1], span = bands[b][2];
    var bitmap = [];
    for (var row = 0; row < 5; row++) {
      var parts = [];
      for (var ci = 0; ci < text.length; ci++) {
        var glyph = font[text.charAt(ci)] || font[' '];
        parts.push(glyph[row]);
      }
      bitmap.push(parts.join('0'));
    }
    var left = py.pyfloor(w - span, 2);
    for (var yy = 0; yy < line_h; yy++) {
      var bitmap_row = bitmap[Math.min(4, Math.trunc(yy * 5 / line_h))];
      for (var xx = 0; xx < span; xx++) {
        var idx = Math.min(bitmap_row.length - 1, Math.trunc(xx * bitmap_row.length / span));
        if (bitmap_row.charAt(idx) === '1') ink.push([left + xx, y0 + yy]);
      }
    }
  }
  TITLE_CACHE[key] = ink;
  return ink;
}

function title_takeover(c, t, font, source) {
  var elapsed = t - 15.22;
  var w = c.w, h = c.h;
  var cx = (w - 1) / 2, cy = (h - 1) / 2;
  var alphabet = '0123456789ABCDEF<>[]{}();:=/\\|+-*#';
  var ink = title_pixels(w, h, font);
  var frame = Math.trunc(elapsed * 24);
  var lock = clamp((elapsed - 4.1) / 2.8);
  var dissolve = clamp((elapsed - 11.35) / 2.36);

  // PRE-TRANSITION EFFECT (15.02-15.22s becomes -0.2-0s elapsed)
  if (elapsed < 0) {
    var buildup = clamp((elapsed + 0.2) / 0.2);
    if (py.pymod(Math.trunc(t * 30 * buildup), 2) === 0) {
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          if (hash16(x + y * w + Math.trunc(t * 100)) % 100 < buildup * 50) {
            c.cells[y][x] = ['█', buildup > 0.7 ? W : B];
          }
        }
      }
    }
    var wave_count = Math.trunc(buildup * 5) + 1;
    for (var i = 0; i < wave_count; i++) {
      var phase = py.pymod(buildup * 3 - i * 0.15, 1);
      if (phase < 0) continue;
      var y_top = Math.trunc(phase * h / 2);
      var y_bot = h - 1 - y_top;
      for (var wx = 0; wx < w; wx++) {
        if (hash16(wx + i) % 3 === 0) {
          c.put(wx, y_top, phase > 0.7 ? '=' : '-', phase > 0.8 ? W : B);
          c.put(wx, y_bot, phase > 0.7 ? '=' : '-', phase > 0.8 ? W : B);
        }
      }
      var x_left = Math.trunc(phase * w / 2);
      var x_right = w - 1 - x_left;
      for (var wy = 0; wy < h; wy++) {
        if (hash16(wy + i * 7) % 3 === 0) {
          c.put(x_left, wy, '|', phase > 0.8 ? W : B);
          c.put(x_right, wy, '|', phase > 0.8 ? W : B);
        }
      }
    }
    if (buildup > 0.5) {
      var radius = Math.trunc((1 - buildup) * Math.min(w, h) * 0.3);
      for (var a = 0; a < 60; a++) {
        var angle = a * TAU / 60 + t * 5;
        c.put(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.5,
              buildup > 0.8 ? '*' : '+', buildup > 0.9 ? W : B);
      }
    }
    for (var g = 0; g < Math.trunc(buildup * 8); g++) {
      var g_row = hash16(Math.trunc(t * 50) + g) % h;
      var shift = Math.trunc(Math.sin(t * 20 + g) * buildup * 15);
      if (shift !== 0) c.cells[g_row] = py.rotateRow(c.cells[g_row], shift);
    }
    return;
  }

  var density = elapsed < 5 ? .78 : mix(.60, .10, lock);
  if (dissolve) density = mix(.1, .48, dissolve);
  for (var ty = 0; ty < h; ty++) {
    var row_shift = Math.trunc(Math.sin(elapsed * 4 + ty * .31) * clamp(elapsed / 2) * 9);
    for (var tx = 0; tx < w; tx++) {
      var k = hash16(tx * 37 + ty * 911 + Math.trunc(elapsed * 7) * (3 + tx % 7));
      if (k / 65535 > density) continue;
      var char = alphabet.charAt(py.pymod(k + frame + py.pyfloor(tx, 7) * 13, alphabet.length));
      var style = (ty + py.pyfloor(frame, 2)) % h < 2 ? N : (k % 17 === 0 ? D : G);
      if (lock > .5) style = k % 5 === 0 ? G : K;
      c.put(py.pymod(tx + row_shift, w), ty, char, style);
    }
  }
  if (source) {
    var e = clamp(elapsed / 2.1);
    for (var sy = 0; sy < source.cells.length; sy++) {
      var s_row = source.cells[sy];
      for (var sx = 0; sx < s_row.length; sx++) {
        var ch = s_row[sx][0];
        if (ch.trim() === '') continue;
        var sk = hash16(sx + sy * w);
        var s_angle = Math.atan2((sy - cy) * 2, sx - cx) + e * (1 + sk % 7 * .13);
        var s_radius = Math.hypot(sx - cx, (sy - cy) * 2) * (1 + e * .9);
        var px = cx + Math.cos(s_angle) * s_radius + Math.sin(sy * .45 + elapsed * 9) * e * 6;
        var pyy = cy + Math.sin(s_angle) * s_radius / 2;
        if (e > .3 && sk % 5 < Math.trunc(e * 5)) ch = alphabet.charAt((sk + frame) % alphabet.length);
        else if (ch.codePointAt(0) > 127) ch = alphabet.charAt(sk % alphabet.length);
        c.put(py.pymod(py.pyRound(px), w), py.pymod(py.pyRound(pyy), h), ch, e < .5 ? N : D);
      }
    }
  }
  if (elapsed < 4.6) {
    for (var strand = 0; strand < 7; strand++) {
      for (var xx = 0; xx < w; xx++) {
        var s_strand_angle = xx / w * TAU * 1.7 - elapsed * 2 + strand * .39;
        var yy = cy + Math.sin(s_strand_angle) * h * .37;
        if (strand % 2) yy += Math.sin(xx * .19 + elapsed * 3) * 2;
        for (var trail = 0; trail < 3; trail++) {
          c.put(xx, yy + trail,
                trail === 0 ? alphabet.charAt(py.pymod(xx + frame + strand, alphabet.length)) : '.',
                trail === 0 ? B : G);
        }
      }
    }
  }
  if (elapsed >= 3.1) {
    for (var ii = 0; ii < ink.length; ii++) {
      var tx2 = ink[ii][0], ty2 = ink[ii][1];
      var ik = hash16(ii * 7 + 51);
      var delay = (ik % 1000) / 1000 * .95;
      var u = clamp((elapsed - 3.1 - delay) / 3.0);
      var ease = 1 - Math.pow(1 - u, 3);
      var ox = hash16(ii * 17) % w;
      var oy = hash16(ii * 29 + 10) % h;
      var x2, y2;
      if (dissolve) {
        var d_angle = Math.atan2((ty2 - cy) * 2, tx2 - cx) + dissolve * .75;
        var d_dist = Math.hypot(tx2 - cx, (ty2 - cy) * 2) + dissolve * (30 + ik % 40);
        x2 = cx + Math.cos(d_angle) * d_dist;
        y2 = cy + Math.sin(d_angle) * d_dist / 2;
        if (ik % 100 / 100 < dissolve * .65) continue;
      } else {
        var swirl = Math.sin(u * Math.PI) * (1 - u);
        x2 = mix(ox, tx2, ease) + Math.sin(elapsed * 2 + ii * .7) * swirl * w * .24;
        y2 = mix(oy, ty2, ease) + Math.cos(elapsed * 2 + ii * .7) * swirl * h * .24;
      }
      var ch2, style2;
      if (u > .98 && !dissolve) {
        var sweep = py.pymod(Math.trunc(elapsed * 30), w + 24) - 12;
        var on_sweep = Math.abs(tx2 - sweep) < 3;
        ch2 = on_sweep ? '#' : '01'.charAt(ik % 2);
        style2 = on_sweep ? W : B;
      } else {
        ch2 = alphabet.charAt((ik + frame) % alphabet.length);
        style2 = ik % 3 === 0 ? B : N;
      }
      c.put(py.pyRound(x2), py.pyRound(y2), ch2, style2);
      if (u < .98 || dissolve) c.put(py.pyRound(x2) - 1, py.pyRound(y2), '.', G);
    }
  }
  if (7.25 < elapsed && elapsed < 11.35) {
    c.center(1, 'M I L I', W);
    c.center(h - 3, 'world.execute(me);', W);
  }
  if (py.pymod(Math.trunc(elapsed * 12), 11) === 0
      || py.pymod(Math.trunc(elapsed * 12), 11) === 1
      || py.pymod(Math.trunc(elapsed * 12), 11) === 2) {
    var t_row = hash16(frame) % h;
    var t_shift = Math.trunc(Math.sin(elapsed * 23) * 7);
    if (t_shift) c.cells[t_row] = py.rotateRow(c.cells[t_row], t_shift);
  }
}

// ============ MAIN SCENE DISPATCHER ============
// Same ordered time ladder as scenes.py:2921-3058; scenes not yet ported
// (later batches) would raise ReferenceError if their branch ran.
function draw_scene(c, t, top, bt, pulse, e) {
  var area = simple_area(c, top, bt);
  var lyric_time = e ? e.time : t;
  var elapsed = t - lyric_time;
  if (t < 16) {
    if (t < 1.74) lyric_power_line(c, t, area, t - 0.1);
    else if (t < 2.92) lyric_power_line(c, t, area, 1.6);  // frozen at end state
    else if (t < 3.873) lyric_protection(c, t, area, t - 2.92);
    else if (t < 5.491) lyric_lay_pieces(c, t, area, t - 3.873);
    else if (t < 6.38) lyric_lay_pieces(c, t, area, t - 3.873);
    else if (t < 7.446) lyric_object_creation(c, t, area, t - 6.38);
    else if (t < 10.091) lyric_data_parameters(c, t, area, t - 7.446);
    else if (t < 11.095) lyric_data_parameters(c, t, area, t - 7.446);
    else if (t < 16) lyric_simulation(c, t, area, t - 11.095);
  } else if (t < 29.709) {
    // Title takeover, composed by Film.render (player.py side).
  } else if (t < 59.223) {
    if (t < 33.412) lyric_points_dimension(c, t, area, t - 29.709);
    else if (t < 37.067) lyric_circle_circumference(c, t, area, t - 33.412);
    else if (t < 40.706) lyric_sine_tangent(c, t, area, t - 37.067);
    else if (t < 44.452) lyric_infinity_limit(c, t, area, t - 40.706);
    else if (t < 47.672) lyric_ac_dc(c, t, area, t - 44.452);
    else if (t < 51.363) lyric_dizzy(c, t, area, t - 47.672);
    else if (t < 55.083) lyric_time_travel(c, t, area, t - 51.363);
    else if (t < 59.223) lyric_unite_deeply(c, t, area, t - 55.083);
  } else if (t < 74.045) {
    if (t < 62.589) lyric_stimulation_satisfaction(c, t, area, t - 59.223);
    else if (t < 66.601) lyric_stimulation_satisfaction(c, t, area, t - 59.223);
    else if (t < 70.084) lyric_happy_execution(c, t, area, pulse);
    else if (t < 74.045) lyric_trapped_simulation(c, t, area, pulse);
  } else if (t < 85.078) {
    legacy_organic(c, t, top, bt, pulse);
  } else if (t < 88.587) {
    lyric_god_existence(c, t, area, t - 85.078);
  } else if (t < 103.489) {
    if (t < 92.015) lyric_identity_rewrite(c, t, area);
    else if (t < 95.465) lyric_daynight_clock(c, t, area);
    else if (t < 99.349) lyric_gender_role_switch(c, t, area, t - 95.465, 'S', 'M');
    else lyric_dizzy(c, t, area, t - 99.349);
  } else if (t < 110.9) {
    lyric_vibration_sync(c, t, area, t - 103.489);
  } else if (t < 118.333) {
    lyric_isolation_disconnect(c, t, area, t - 110.9);
  } else if (t < 125.708) {
    lyric_erase_fragments(c, t, area, t - 118.333);
  } else if (t < 147.66) {
    lyric_illegal_arguments(c, t, area, t - 125.708);
  } else if (t < 177.246) {
    if (t < 158.9) lyric_execution_queue(c, t, area, t - 147.66);
    else if (t < 162.632) lyric_multilingual_count(c, t, area);
    else lyric_only_execution(c, t, area, pulse);
  } else if (t < 192.5) {
    if (t < 188.483) lyric_love_equation(c, t, area, t - 177.246);
    else lyric_trapped_loop(c, t, area, Math.min(t - 188.483, 4), pulse);
  } else {
    lyric_outro_wait(c, t, area, t - 192.5);
  }
  if (t < 192.5 && !(74.045 <= t && t < 85.078) && !(103.489 <= t && t < 110.9)) {
    apply_glitch(c, t, top, bt);
  }
}

function phosphor(c, t, top, bt) {
  if (74.045 <= t && t < 85.078) {
    legacy_phosphor(c, t, top, bt);
    return;
  }
  var intensity = glitch_intensity(t);
  if (hash16(Math.trunc(t * 10)) % 100 < intensity * 50) {
    var row = top + py.pymod(Math.trunc(t * 9), Math.max(1, bt - top + 1));
    for (var x = 2; x < c.w - 2; x++) {
      if (row < c.cells.length && x < c.cells[row].length) {
        var cell = c.cells[row][x];
        if (cell[0] !== '' && cell[0] !== ' ' && (cell[1] === D || cell[1] === N || cell[1] === G)) {
          c.cells[row][x] = [cell[0], cell[1] === G ? N : B];
        }
      }
    }
  }
}

MV.scenes = {
  draw_scene: draw_scene,
  phosphor: phosphor,
  title_takeover: title_takeover,
  title_pixels: title_pixels,
  glitch_intensity: glitch_intensity,
  apply_glitch: apply_glitch,
  simple_area: simple_area,
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
