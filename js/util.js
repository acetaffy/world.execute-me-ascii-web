// Python-semantics compatibility helpers.
//
// Every ported formula keeps CPython's exact numeric behavior: int() is
// Math.trunc (not floor), // is pyfloor, % is pymod (non-negative for a
// positive modulus), round() is pyRound (half-to-even), and f-string number
// formatting goes through pyFixed/padInt/padHex (half-to-even on the exact
// double, sign-aware padding). See the porting plan for the verified vectors.
(function (root) { 'use strict';
var MV = root.MV || (root.MV = {});

function mix(a, b, u) { return a + (b - a) * u; }

function clamp(x, a, b) {
  if (a === undefined) a = 0;
  if (b === undefined) b = 1;
  return Math.min(b, Math.max(a, x));
}

// Deterministic 32-bit avalanche hash; the port's only source of "randomness".
// Math.imul keeps the low 32 bits exact, >>> 0 is Python's & 0xFFFFFFFF.
function hash16(i) {
  var v = (Math.trunc(i) + 0x9E3779B9) >>> 0;
  v = Math.imul(v ^ (v >>> 16), 0x7FEB352D) >>> 0;
  v = Math.imul(v ^ (v >>> 15), 0x846CA68B) >>> 0;
  return (v ^ (v >>> 16)) & 0xFFFF;
}

// Python's % keeps the sign of the divisor; JS % keeps the sign of the
// dividend. This is CPython's correction step, bit-exact for doubles.
function pymod(a, b) {
  var r = a % b;
  if (r !== 0 && (r < 0) !== (b < 0)) r += b;
  return r;
}

// Python's // for floats is floor of the *exact* quotient (fmod-corrected,
// see CPython float_divmod), not floor(a/b), which can round the wrong way.
function pyfloor(a, b) {
  if (b === undefined) return Math.floor(a);
  var mod = a % b;
  var div = (a - mod) / b;
  if (mod !== 0) {
    if ((b < 0) !== (mod < 0)) { mod += b; div -= 1; }
  }
  if (div !== 0) return Math.floor(div);
  return div;
}

// Python round() for floats: half-to-even against the exact binary value.
function pyRound(x) {
  var base = Math.floor(x);
  var diff = x - base;
  if (diff < 0.5) return base;
  if (diff > 0.5) return base + 1;
  return base % 2 === 0 ? base : base + 1;
}

// Exact binary decomposition of a positive finite double: v = num/den.
function exactParts(v) {
  var view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, v);
  var bits = view.getBigUint64(0);
  var exponent = Number((bits >> 52n) & 0x7FFn);
  var fraction = bits & 0xFFFFFFFFFFFFFn;
  var mantissa, power;
  if (exponent === 0) { mantissa = fraction; power = -1074; }
  else { mantissa = fraction | (1n << 52n); power = exponent - 1075; }
  return power >= 0 ? [mantissa << BigInt(power), 1n] : [mantissa, 1n << BigInt(-power)];
}

// Python's f-string fixed-point formatting: correctly-rounded decimal,
// ties to even, sign of negative zero preserved.
function pyFixed(v, digits) {
  if (!isFinite(v)) return String(v);
  var negative = v < 0 || Object.is(v, -0);
  var parts = exactParts(Math.abs(v));
  var scale = 10n ** BigInt(digits);
  var numerator = parts[0] * scale;
  var quotient = numerator / parts[1];
  var remainder = numerator % parts[1];
  var twice = remainder * 2n;
  if (twice > parts[1] || (twice === parts[1] && quotient % 2n === 1n)) quotient += 1n;
  var text = quotient.toString();
  if (digits > 0) {
    while (text.length <= digits) text = '0' + text;
    text = text.slice(0, text.length - digits) + '.' + text.slice(text.length - digits);
  }
  return (negative ? '-' : '') + text;
}

// f'{v:+.1f}': always a sign, then pyFixed.
function pyPlusFixed(v, digits) {
  var text = pyFixed(v, digits);
  return text.charAt(0) === '-' ? text : '+' + text;
}

function padInt(value, width, pad) {
  if (pad === undefined) pad = '0';
  var text = String(Math.trunc(value));
  // Zero fill goes after the sign (f'{-5:03d}' == '-05'); any other fill pads
  // the whole right-aligned field (f'{-5:3d}' == ' -5').
  if (pad === '0' && text.charAt(0) === '-') {
    var digits = text.slice(1);
    while (digits.length < width - 1) digits = '0' + digits;
    return '-' + digits;
  }
  while (text.length < width) text = pad + text;
  return text;
}

function padHex(value, width) {
  var v = Math.trunc(value);
  var sign = v < 0 ? '-' : '';
  var text = Math.abs(v).toString(16).toUpperCase();
  while (text.length < width - sign.length) text = '0' + text;
  return sign + text;
}

// 'x' * n: Python yields '' for n <= 0, JS repeat() throws.
function pyRepeat(s, n) {
  n = Math.trunc(n);
  return n > 0 ? s.repeat(n) : '';
}

// f'{v:05.1f}': fixed-point, then sign-aware zero padding.
function padFixed(value, digits, width, pad) {
  if (pad === undefined) pad = '0';
  var text = pyFixed(value, digits);
  var sign = '';
  if (text.charAt(0) === '-') { sign = '-'; text = text.slice(1); }
  while (text.length < width - sign.length) text = pad + text;
  return sign + text;
}

// -------- East-Asian width (player.py cw/width/crop/wrap) --------
// Wide (W) and Fullwidth (F) ranges; Ambiguous stays width 1, matching the
// renderer (scenes' 38 decorative glyphs are all A/N by design).
var WIDE = [
  [0x1100, 0x115F], [0x2329, 0x232A], [0x2E80, 0x303E], [0x3041, 0x33FF],
  [0x3400, 0x4DBF], [0x4E00, 0x9FFF], [0xA000, 0xA4CF], [0xA960, 0xA97F],
  [0xAC00, 0xD7A3], [0xF900, 0xFAFF], [0xFE10, 0xFE19], [0xFE30, 0xFE6B],
  [0xFF00, 0xFF60], [0xFFE0, 0xFFE6],
];
var COMBINING = [
  [0x0300, 0x036F], [0x1AB0, 0x1AFF], [0x1DC0, 0x1DFF], [0x20D0, 0x20FF],
  [0xFE20, 0xFE2F],
];

function inRanges(code, ranges) {
  for (var i = 0; i < ranges.length; i++) {
    if (code >= ranges[i][0] && code <= ranges[i][1]) return true;
  }
  return false;
}

function cw(ch) {
  var code = ch.codePointAt(0);
  if (inRanges(code, COMBINING)) return 0;
  return inRanges(code, WIDE) ? 2 : 1;
}

function width(s) {
  var total = 0;
  for (var ch of s) total += cw(ch);
  return total;
}

function crop(s, n) {
  var out = '', used = 0;
  for (var ch of s) {
    var k = cw(ch);
    if (used + k > n) break;
    out += ch; used += k;
  }
  return out;
}

function wrap(s, n) {
  if (width(s) <= n) return [s];
  var parts = [];
  while (s) {
    var line = crop(s, n);
    if (line.length < s.length && line.indexOf(' ') >= 0 && isAsciiOnly(s)) {
      line = line.slice(0, line.lastIndexOf(' '));
    }
    parts.push(line);
    s = s.slice(line.length).replace(/^\s+/, '');
  }
  return parts;
}

function isAsciiOnly(s) {
  for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

function bisectRight(array, x) {
  var lo = 0, hi = array.length;
  while (lo < hi) {
    var mid = (lo + hi) >>> 1;
    if (x < array[mid]) hi = mid; else lo = mid + 1;
  }
  return lo;
}

// Python cells[-shift:] + cells[:-shift] (a rotation; the sign flips the
// direction through negative indexing, and slice() matches that exactly).
function rotateRow(cells, shift) {
  return cells.slice(-shift).concat(cells.slice(0, -shift));
}

MV.py = {
  mix: mix, clamp: clamp, hash16: hash16, pymod: pymod, pyfloor: pyfloor,
  pyRound: pyRound, pyFixed: pyFixed, pyPlusFixed: pyPlusFixed,
  padInt: padInt, padHex: padHex, padFixed: padFixed, pyRepeat: pyRepeat,
  cw: cw, width: width, crop: crop, wrap: wrap, bisectRight: bisectRight,
  rotateRow: rotateRow,
};
})(typeof globalThis !== 'undefined' ? globalThis : this);
