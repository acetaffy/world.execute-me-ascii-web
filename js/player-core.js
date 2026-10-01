// MV.PlayerCore — the playback state machine, DOM-free on purpose.
//
// Mirrors the semantics of player.py's run loop (start slate, pause toggle,
// seek clamps, chapter jumps, lyric stepping, subtitle offset, volume, the
// end-of-track freeze) but reads time from an injected clock object:
//
//   clock.snapshot() -> {time, duration, playing}
//   clock.play() clock.pause() clock.seek(seconds) clock.setVolume(v)
//
// player.js wires it to an HTMLAudioElement;
// tests drive it with a fake clock. The clock owns the timeline, exactly like
// the Swift audio-clock subprocess does on macOS.
(function (root) { 'use strict';
var MV = root.MV || (root.MV = {});

function PlayerCore(film, clock) {
  this.film = film;
  this.clock = clock;
  this.started = false;
  this.paused = true;
  this.ready = true;
  this.helpOn = false;
  this.offset = film.config.subtitle_offset || 0;
  this.volume = 0.75;
  this.playingSeen = false;
  this.current = 0;
  this.width = 100;
  this.height = 40;
  clock.setVolume(this.volume);
}

PlayerCore.prototype.seekClamp = function (t) {
  var duration = this.clock.snapshot().duration || this.film.config.duration;
  return Math.min(duration - 0.05, Math.max(0, t));
};

PlayerCore.prototype.startPlayback = function () {
  this.started = true;
  this.ready = false;
  this.paused = false;
  this.clock.play();
};

PlayerCore.prototype.togglePause = function () {
  if (!this.started) { this.startPlayback(); return 'start'; }
  this.paused = !this.paused;
  if (this.paused) this.clock.pause(); else this.clock.play();
  return 'pause';
};

PlayerCore.prototype.seekBy = function (delta) {
  // The clock owns the timeline; this.current only refreshes on frame().
  this.clock.seek(this.seekClamp(this.clock.snapshot().time + delta));
  return 'seek';
};

PlayerCore.prototype.restart = function () {
  this.clock.seek(0);
  this.startPlayback();
  return 'restart';
};

PlayerCore.prototype.jumpChapter = function (index) {
  this.clock.seek(this.seekClamp(MV.CHAPTERS[index][0]));
  this.startPlayback();
  return 'chapter';
};

PlayerCore.prototype.stepLyric = function (direction) {
  var current = this.clock.snapshot().time;
  var i = MV.py.bisectRight(this.film.times, current + 0.03) - 1;
  i = Math.min(this.film.times.length - 1, Math.max(0, i + direction));
  this.clock.seek(this.seekClamp(this.film.times[i]));
  this.started = true;
  this.ready = false;
  return 'lyric';
};

PlayerCore.prototype.adjustOffset = function (delta) {
  // Python: round(offset + 0.1, 2) — correctly rounded decimal, ties to even.
  this.offset = Number(MV.py.pyFixed(this.offset + delta, 2));
  return 'offset';
};

PlayerCore.prototype.adjustVolume = function (delta) {
  this.volume = delta > 0 ? Math.min(1, this.volume + delta) : Math.max(0, this.volume + delta);
  this.clock.setVolume(this.volume);
  return 'volume';
};

PlayerCore.prototype.toggleHelp = function () {
  this.helpOn = !this.helpOn;
  return 'help';
};

PlayerCore.prototype.returnToReady = function () {
  // The browser counterpart of the terminal player's Q (quit to the slate).
  this.started = false;
  this.ready = true;
  this.paused = true;
  this.playingSeen = false;
  this.clock.pause();
  this.clock.seek(0);
  return 'ready';
};

PlayerCore.prototype.handleKey = function (key) {
  if (key === ' ' || key === 'Enter' || key === '\r' || key === '\n') return this.togglePause();
  if (key === 'ArrowLeft') return this.seekBy(-5);
  if (key === 'ArrowRight') return this.seekBy(5);
  if (key === 'r' || key === 'R') return this.restart();
  if (key >= '1' && key <= '5') return this.jumpChapter(Number(key) - 1);
  if (key === '[') return this.adjustOffset(0.1);
  if (key === ']') return this.adjustOffset(-0.1);
  if (key === ',') return this.stepLyric(-1);
  if (key === '.') return this.stepLyric(1);
  if (key === 'h' || key === 'H') return this.toggleHelp();
  if (key === '+' || key === '=') return this.adjustVolume(0.05);
  if (key === '-') return this.adjustVolume(-0.05);
  if (key === 'q' || key === 'Q') return this.returnToReady();
  return 'none';
};

PlayerCore.prototype.frame = function () {
  var state = this.clock.snapshot();
  var current = state.time;
  if (state.playing) this.playingSeen = true;
  if (this.playingSeen && !state.playing && !this.paused && current < 0.05) {
    // The track wrapped or restarted underneath us: freeze at the end,
    // mirroring player.py's "seek duration-.02, paused=True" behavior.
    current = state.duration;
    this.paused = true;
    this.clock.pause();
    this.clock.seek(Math.max(0, state.duration - 0.02));
  }
  if (current >= state.duration - 0.05 && !state.playing && this.started) this.paused = true;
  this.current = current;
  return {
    canvas: this.film.render(current, this.width, this.height, this.paused,
                             this.offset, this.helpOn, this.ready),
    time: current,
    duration: state.duration,
    playing: state.playing,
    paused: this.paused,
    ready: this.ready,
  };
};

MV.PlayerCore = PlayerCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
