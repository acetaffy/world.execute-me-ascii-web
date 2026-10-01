// MV.Film — the whole-frame composition, mirrored from player.py's Film.
//
// render(t, w, h, paused, offset, help_on, ready) is a pure function of its
// arguments plus MV.LYRICS / MV.SPECTRUM / MV.CONFIG: no cross-frame state,
// no randomness. Everything the terminal version draws here (header, clock,
// chapter label, spectrum strip, captions, hint, slate, help panel, resize
// card) is reproduced byte for byte, including the hardcoded '03:32'.
(function (root) { 'use strict';
var MV = root.MV || (root.MV = {});
var py = MV.py;

MV.CHAPTERS = [[0, '01 / CREATION', 'Creation'], [29.709, '02 / DEVOTION', 'Devotion'],
               [110.9, '03 / ISOLATION', 'Isolation'], [125.708, '04 / EXECUTION', 'Execution'],
               [177.246, '05 / LOVE', 'Love']];

// The title takeover window: the frame fills edge to edge with the
// disintegrating/reforming title between chapters 01 and 02.
MV.TITLE_WINDOW = [15.02, 29.709];

function Film() {
  this.lyrics = MV.LYRICS;
  this.times = this.lyrics.map(function (entry) { return entry.time; });
  this.spectrum = MV.SPECTRUM;
  this.config = MV.CONFIG;
  this.hint = 'SPACE play/pause   <- -> 5s   R restart   Q quit   H help';
  this.cardHint = 'SPACE pause  Q quit';
}

Film.prototype.cue = function (t) {
  var idx = py.bisectRight(this.times, t) - 1;
  var entry = idx >= 0 ? this.lyrics[idx] : null;
  return entry && t < entry.end ? entry : null;
};

Film.prototype.energy = function (t) {
  var frames = this.spectrum.frames;
  return frames[Math.min(frames.length - 1, Math.max(0, Math.trunc(t * this.spectrum.fps)))];
};

Film.prototype.render = function (t, w, h, paused, offset, help_on, ready) {
  if (paused === undefined) paused = false;
  if (offset === undefined) offset = 0;
  if (help_on === undefined) help_on = false;
  if (ready === undefined) ready = false;
  var c = new MV.Canvas(w, h);
  if (w < 64 || h < 24) {
    c.center(py.pyfloor(h, 2) - 2, 'WORLD.EXECUTE(ME);', MV.BRIGHT);
    c.center(py.pyfloor(h, 2), 'Enlarge the window', MV.WHITE);
    c.center(py.pyfloor(h, 2) + 2, w + ' x ' + h + ' / minimum 64 x 24', MV.NORMAL);
    c.center(py.pyfloor(h, 2) + 4, this.cardHint, MV.DIM);
    return c;
  }
  if (MV.TITLE_WINDOW[0] <= t && t < MV.TITLE_WINDOW[1] && !ready) {
    // The source is one frame before the takeover so the last live frame
    // disintegrates into the title.
    var source = t < 17.32 ? this.render(15.019, w, h, paused, offset, false, false) : null;
    MV.scenes.title_takeover(c, t, MV.FONT, source);
    if (help_on) this.help(c, offset);
    return c;
  }
  var entry = this.cue(t + offset);
  var act = MV.CHAPTERS[0];
  for (var i = 0; i < MV.CHAPTERS.length; i++) {
    if (MV.CHAPTERS[i][0] <= Math.max(0, t)) act = MV.CHAPTERS[i];
  }
  c.put(2, 0, 'WORLD.EXECUTE(ME);', MV.BRIGHT);
  var state = ready ? 'READY' : (paused ? 'PAUSED' : 'RUNNING');
  var clock = py.padInt(py.pyfloor(Math.trunc(t), 60), 2, '0') + ':'
            + py.padInt(py.pymod(Math.trunc(t), 60), 2, '0') + '.'
            + py.pymod(Math.trunc(t * 10), 10) + ' / 03:32  ' + state;
  c.put(w - py.width(clock) - 2, 0, clock, MV.DIM);
  c.put(2, 1, py.pyRepeat('-', w - 4), MV.DIM);
  c.put(2, 2, act[1], MV.NORMAL);
  var top = 4, bottom = h - 8;
  var spec = this.energy(t);
  var pulse = 0;
  for (var band = 0; band < 10; band++) pulse += spec[band];
  pulse /= 10;
  c.clip = [top, bottom];
  MV.scenes.draw_scene(c, t, top, bottom, pulse, entry);
  MV.scenes.phosphor(c, t, top, bottom);
  c.clip = null;
  // Spectrum is measured from the supplied song, sampled on the audio clock.
  var sy = h - 6, cols = Math.min(80, w - 8), start = py.pyfloor(w - cols, 2);
  for (var col = 0; col < cols; col++) {
    var amp = spec[Math.trunc(col * 48 / cols)];
    c.put(start + col, sy, '._:=|'[Math.min(4, py.pyRound(amp * 4))], MV.DIM);
  }
  if (ready) {
    c.center(h - 5, 'MILI  /  world.execute(me);', MV.WHITE);
    c.center(h - 3, '[ SPACE / ENTER TO START ]', MV.BRIGHT);
  } else if (entry) {
    var ens = py.wrap(entry.en, w - 8);
    // English subtitles anchor a few rows above the bottom of the frame.
    for (var en = 0; en < Math.min(2, ens.length); en++) c.center(h - 4 + en, ens[en], MV.WHITE);
  } else if (t > 208) {
    c.center(h - 4, 'PROCESS ENDED. THE LOOP REMAINS.', MV.WHITE);
  } else {
    c.center(h - 4, '[ instrumental ]', MV.DIM);
  }
  c.center(h - 1, py.crop(this.hint, w - 4), MV.DIM);
  if (ready) this.slate(c, top, bottom);
  if (help_on) this.help(c, offset);
  return c;
};

Film.prototype.slate = function (c, top, bottom) {
  for (var y = top; y <= bottom; y++) c.put(0, y, py.pyRepeat(' ', c.w), MV.DIM);
  var cy = Math.trunc((top + bottom) / 2);
  c.center(top + 1, 'A TERMINAL MUSIC VIDEO', MV.DIM);
  c.big(Math.max(top + 2, cy - 4), 'EXECUTE(ME);', MV.BRIGHT);
  c.center(cy + 3, 'M I L I', MV.WHITE);
  c.center(Math.min(bottom, cy + 6), '[ SPACE / ENTER TO START ]', MV.BRIGHT);
};

Film.prototype.help = function (c, offset) {
  var lines = ['CONTROLS', 'SPACE / ENTER   play / pause', 'LEFT / RIGHT    back / forward 5s',
               'R               restart', '1 2 3 4 5       jump to a chapter', '[ / ]           subtitles earlier / later 0.1s',
               ', / .           previous / next line',
               '+ / -           volume', 'Q / ESC         quit', 'H               close help',
               'subtitle offset ' + py.pyPlusFixed(offset, 1) + 's'];
  var w = Math.min(c.w - 4, 58);
  var x = py.pyfloor(c.w - w, 2);
  var y = py.pyfloor(c.h - lines.length - 3, 2);
  for (var yy = y; yy < y + lines.length + 3; yy++) c.put(x, yy, py.pyRepeat(' ', w), MV.NORMAL);
  c.box(x, y, w, lines.length + 3, MV.BRIGHT);
  for (var i = 0; i < lines.length; i++) {
    c.put(x + 3, y + 2 + i, lines[i], i === 0 ? MV.WHITE : MV.NORMAL);
  }
};

MV.Film = Film;
})(typeof globalThis !== 'undefined' ? globalThis : this);
