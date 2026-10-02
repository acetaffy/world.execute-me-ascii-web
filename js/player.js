// Browser wiring: the audio element, the rAF loop, the DOM overlays,
// keyboard, drag & drop and fullscreen.
//
// The clock mirrors AudioClock.swift's contract: the audio device owns the
// timeline and the renderer follows it. The page loads media/song.flac next
// to itself; until it is ready an idle clock keeps the start slate visible.
(function (root) { 'use strict';
var MV = root.MV;
var doc = root.document;

var FPS = 24;
var AUDIO_CANDIDATES = ['media/song.flac', '../media/song.flac'];

// Credit where it is due: the original song and lyrics are Mili's, and this
// page only ships the visual player - the audio never leaves your machine.
console.log(
  '%cworld.execute(me); -ascii%c\n' +
  'A terminal-style ASCII music video for Mili\'s "world.execute(me);".\n' +
  'Source: https://github.com/yym8224961/world.execute-me-ascii\n' +
  'Web version: https://github.com/acetaffy/world.execute-me-ascii-web\n' +
  'The original terminal player was made with GPT-6 Astra.\n' +
  'The browser port was made with DeepSeek-V4.1-Flash.\n' +
  'Personal, non-commercial tribute and archival project: no additional rights to \n' +
  'the original song, lyrics or any other third-party material are granted.\n' +
  'Music & lyrics © Mili.',
  'font:bold 14px monospace;color:#FFD75F',
  'font:12px monospace;color:#AF875F');

function AudioClock(audio) {
  this.audio = audio;
  this.lastTime = -1;
  this.anchor = 0;
  this.anchorStamp = 0;
}
AudioClock.prototype.snapshot = function () {
  var raw = this.audio.currentTime || 0;
  if (!this.audio.paused && !this.audio.ended) {
    // Some browsers update currentTime coarsely; interpolate between updates.
    if (raw !== this.lastTime) {
      this.lastTime = raw;
      this.anchor = raw;
      this.anchorStamp = root.performance.now();
    }
    var smooth = this.anchor + (root.performance.now() - this.anchorStamp) / 1000;
    raw = Math.max(raw, Math.min(smooth, (this.audio.duration || Infinity) - 0.001));
  }
  return { time: raw, duration: this.audio.duration || MV.CONFIG.duration, playing: !this.audio.paused && !this.audio.ended };
};
AudioClock.prototype.play = function () { var promise = this.audio.play(); if (promise && promise.catch) promise.catch(function () {}); };
AudioClock.prototype.pause = function () { this.audio.pause(); };
AudioClock.prototype.seek = function (t) { this.lastTime = -1; this.audio.currentTime = Math.max(0, t); };
AudioClock.prototype.setVolume = function (v) { this.audio.volume = v; };

// Holds the timeline at zero until the audio element is ready.
function IdleClock(duration) {
  this.duration = duration;
}
IdleClock.prototype.snapshot = function () { return { time: 0, duration: this.duration, playing: false }; };
IdleClock.prototype.play = function () {};
IdleClock.prototype.pause = function () {};
IdleClock.prototype.seek = function () {};
IdleClock.prototype.setVolume = function () {};

// Forwards to the audio clock once the song has loaded.
function ActiveClock() {
  this.idle = new IdleClock(MV.CONFIG.duration);
  this.audioClock = null;
}
ActiveClock.prototype.current = function () { return this.audioClock || this.idle; };
ActiveClock.prototype.snapshot = function () { return this.current().snapshot(); };
ActiveClock.prototype.play = function () { this.current().play(); };
ActiveClock.prototype.pause = function () { this.current().pause(); };
ActiveClock.prototype.seek = function (t) { this.current().seek(t); };
ActiveClock.prototype.setVolume = function (v) { this.current().setVolume(v); };

function main() {
  var stage = doc.getElementById('stage');
  var screen = doc.getElementById('screen');
  var canvas = doc.getElementById('mv');
  var overlay = doc.getElementById('overlay');
  var overlayNote = doc.getElementById('overlay-note');
  var toast = doc.getElementById('toast');
  var statsBox = doc.getElementById('stats');

  var clock = new ActiveClock();
  var film = new MV.Film();
  film.hint = '';   // set a string here to show the terminal's bottom key-hint line
  var core = new MV.PlayerCore(film, clock);
  var renderer = new MV.Renderer(canvas);
  var audioEl = new Audio();
  audioEl.preload = 'auto';
  audioEl.volume = core.volume;

  var toastTimer = 0;
  var statsOn = false;
  var frameTimes = [];
  var audioPending = false;

  // Query parameters mirror the terminal player's --start/--autoplay flags:
  //   ?start=30.5&autoplay=1
  var params = new URLSearchParams(root.location.search);
  var pendingStart = params.has('start') ? Number(params.get('start')) : null;
  var autoplay = params.get('autoplay') === '1';

  function showToast(text) {
    toast.textContent = text;
    toast.classList.remove('hidden');
    root.clearTimeout(toastTimer);
    toastTimer = root.setTimeout(function () { toast.classList.add('hidden'); }, 1400);
  }

  root.addEventListener('error', function (event) {
    showToast('Error: ' + (event.message || event.type));
  });

  function relayout() {
    var size = renderer.layout(screen.clientWidth, screen.clientHeight);
    core.width = size.cols;
    // One row is reserved blank at the top (renderer.rowOffset).
    core.height = Math.max(1, size.rows - renderer.rowOffset);
  }

  function applyPendingStart() {
    if (pendingStart !== null && !Number.isNaN(pendingStart)) {
      core.clock.seek(core.seekClamp(pendingStart));
      core.started = true;
      core.ready = false;
    }
    pendingStart = null;
    if (autoplay) { autoplay = false; core.startPlayback(); }
  }

  relayout();
  var resizeTimer = 0;
  root.addEventListener('resize', function () {
    root.clearTimeout(resizeTimer);
    resizeTimer = root.setTimeout(function () {
      relayout();
      renderer.draw(core.frame().canvas);
    }, 80);
  });
  doc.addEventListener('fullscreenchange', function () {
    root.setTimeout(function () { relayout(); renderer.draw(core.frame().canvas); }, 50);
  });

  function activateAudio() {
    if (clock.audioClock) return;
    clock.audioClock = new AudioClock(audioEl);
    audioEl.volume = core.volume;
    core.returnToReady();
    applyPendingStart();
    overlay.classList.add('hidden');
  }

  function adoptAudio(url) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var onReady = function () {
        if (settled) return; settled = true;
        audioPending = false;
        audioEl.removeEventListener('error', onError);
        activateAudio();
        resolve(true);
      };
      var onError = function () {
        if (settled) return; settled = true;
        audioPending = false;
        audioEl.removeEventListener('canplaythrough', onReady);
        reject(new Error('audio error'));
      };
      audioEl.addEventListener('canplaythrough', onReady, { once: true });
      audioEl.addEventListener('error', onError, { once: true });
      audioEl.src = url;
      audioPending = true;
      audioEl.load();
    });
  }

  (function tryNext() {
    if (!AUDIO_CANDIDATES.length) {
      overlayNote.textContent = 'media/song.flac not found - put the audio file next to this page in a media/ folder, then reload.';
      overlay.classList.remove('hidden');
      return;
    }
    adoptAudio(AUDIO_CANDIDATES.shift()).catch(tryNext);
  })();

  // Phones have no keyboard: a touch is the start gesture and toggles pause
  // afterwards; it also unlocks the audio element while it still buffers,
  // since play() must ride on a user gesture. Mouse/pen input is left alone -
  // on the desktop the keyboard stays in charge, exactly like the terminal.
  doc.addEventListener('pointerdown', function (event) {
    if (event.pointerType !== 'touch') return;
    if (!clock.audioClock && audioPending) activateAudio();
    if (clock.audioClock) core.togglePause();
  });

  doc.addEventListener('dragover', function (event) { event.preventDefault(); });
  doc.addEventListener('drop', function (event) {
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
      adoptAudio(URL.createObjectURL(event.dataTransfer.files[0])).catch(function () {
        showToast('Could not play that audio file');
      });
    }
  });

  doc.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var key = event.key;
    if (key === 'f' || key === 'F') {
      if (doc.fullscreenElement) doc.exitFullscreen(); else stage.requestFullscreen();
      event.preventDefault();
      return;
    }
    if (key === 'i' || key === 'I') {
      statsOn = !statsOn;
      statsBox.classList.toggle('hidden', !statsOn);
      event.preventDefault();
      return;
    }
    if (!clock.audioClock) return;   // no timeline yet: keys stay inert
    if (key === 'Escape' && core.helpOn) {
      core.toggleHelp();
      event.preventDefault();
      return;
    }
    if (key === ' ' || key.startsWith('Arrow') || key === 'Enter') event.preventDefault();
    var action = core.handleKey(key);
    if (action === 'offset') showToast('Subtitle offset ' + MV.py.pyPlusFixed(core.offset, 1) + 's');
    if (action === 'volume') showToast('Volume ' + Math.round(core.volume * 100) + '%');
  });

  var nextFrame = root.performance.now();
  function onFrame(now) {
    if (now >= nextFrame) {
      // The title takeover fills the frame edge to edge, so the top-row
      // status-bar clearance is dropped while it plays.
      var frameTime = core.clock.snapshot().time;
      var takeover = !core.ready && frameTime >= MV.TITLE_WINDOW[0] && frameTime < MV.TITLE_WINDOW[1];
      var offset = takeover ? 0 : 1;
      if (offset !== renderer.rowOffset) {
        renderer.rowOffset = offset;
        core.height = Math.max(1, renderer.rows - offset);
      }
      var begin = root.performance.now();
      var result = core.frame();
      renderer.draw(result.canvas);
      var elapsedMs = root.performance.now() - begin;
      frameTimes.push(elapsedMs);
      if (frameTimes.length > 24) frameTimes.shift();
      nextFrame += 1000 / FPS;
      if (now > nextFrame) nextFrame = now;
      if (statsOn) {
        var avg = frameTimes.reduce(function (a, b) { return a + b; }, 0) / frameTimes.length;
        statsBox.textContent = FPS + 'fps  frame ' + avg.toFixed(1) + 'ms  '
          + renderer.cols + 'x' + renderer.rows + '  '
          + (clock.audioClock ? 'audio' : 'idle') + '  t=' + result.time.toFixed(2);
      }
    }
    root.requestAnimationFrame(onFrame);
  }
  root.requestAnimationFrame(onFrame);

}

if (doc.readyState === 'loading') {
  doc.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
})(typeof globalThis !== 'undefined' ? globalThis : this);
