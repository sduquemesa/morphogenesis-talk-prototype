(() => {
  "use strict";

  const Context = window.AudioContext || window.webkitAudioContext;
  const LENGTH = 180;
  const $ = (selector) => document.querySelector(selector);
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const between = (a, b) => a + Math.random() * (b - a);
  const smooth = (a, b, v) => {
    const x = clamp((v - a) / (b - a));
    return x * x * (3 - 2 * x);
  };
  const choose = (items) => {
    let n = Math.random() * items.reduce((sum, item) => sum + item.weight, 0);
    for (const item of items) { n -= item.weight; if (n <= 0) return item; }
    return items[items.length - 1];
  };
  // C Lydian dominant, favoring mid-register anchor tones useful on phone speakers.
  const note = choose([
    { name: "A3", hz: 220.00, hue: 29, weight: 0.5 },
    { name: "Bb3", hz: 233.08, hue: 270, weight: 1 },
    { name: "C4", hz: 261.63, hue: 189, weight: 4 },
    { name: "D4", hz: 293.66, hue: 210, weight: 1.2 },
    { name: "E4", hz: 329.63, hue: 37, weight: 3.2 },
    { name: "F#4", hz: 369.99, hue: 159, weight: 3 },
    { name: "G4", hz: 392.00, hue: 177, weight: 2.8 },
    { name: "A4", hz: 440.00, hue: 25, weight: 0.8 },
    { name: "Bb4", hz: 466.16, hue: 271, weight: 2 },
    { name: "C5", hz: 523.25, hue: 192, weight: 0.8 }
  ]);
  const identity = {
    note,
    role: Math.random() < 0.52 ? "bursts" : "merge",
    detune: between(-3.5, 3.5),
    pace: between(0.86, 1.17),
    throbHz: between(0.34, 0.52),
    noiseHz: between(590, 920),
    phase: between(-110, -3)
  };
  const ui = {
    field: $("#field"), enter: $("#enter"), controls: $("#controls"),
    mute: $("#mute"), debugToggle: $("#debug-toggle"), debug: $("#debug"), error: $("#error")
  };
  const state = {
    context: null, nodes: null, sources: [], timer: null, debugTimer: null,
    media: null, mediaUrl: null, session: "default", startAt: null,
    nextPluck: 0, nextBurst: Infinity, phase: "before entry",
    active: false, starting: false, finished: false, muted: false,
    gesture: { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, touching: false }
  };

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function nearSilentWavUrl() {
    const count = 3200;
    const data = new ArrayBuffer(44 + count * 2);
    const view = new DataView(data);
    const label = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    };
    label(0, "RIFF"); view.setUint32(4, 36 + count * 2, true);
    label(8, "WAVE"); label(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 16000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    label(36, "data"); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i += 1) view.setInt16(44 + i * 2, i % 251 === 0 ? 1 : 0, true);
    return URL.createObjectURL(new Blob([data], { type: "audio/wav" }));
  }

  function configureIOSAudio() {
    if (!isIOS()) return;
    if (navigator.audioSession && "type" in navigator.audioSession) {
      try { navigator.audioSession.type = "playback"; state.session = "playback"; return; }
      catch (_) { /* Fall through on older WebKit. */ }
    }
    const media = document.createElement("audio");
    state.mediaUrl = nearSilentWavUrl();
    media.src = state.mediaUrl;
    media.loop = true;
    media.setAttribute("playsinline", "");
    media.hidden = true;
    document.body.appendChild(media);
    state.media = media;
    state.session = "media fallback";
    const result = media.play();
    if (result && typeof result.catch === "function") {
      result.catch(() => { state.session = "fallback blocked"; });
    }
  }

  function createNoise(context) {
    const length = Math.floor(context.sampleRate * 0.36);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const values = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) values[i] = (Math.random() * 2 - 1) * 0.65;
    return buffer;
  }

  function createAudio(context) {
    const master = context.createGain();
    const highpass = context.createBiquadFilter();
    const lowpass = context.createBiquadFilter();
    const toneFilter = context.createBiquadFilter();
    const tone = context.createOscillator();
    const body = context.createOscillator();
    const toneLevel = context.createGain();
    const bodyLevel = context.createGain();
    const pluck = context.createGain();
    const drone = context.createGain();
    const throb = context.createOscillator();
    const throbDepth = context.createGain();
    const throbBase = context.createGain();
    const noiseFilter = context.createBiquadFilter();
    const noiseLevel = context.createGain();

    master.gain.value = 0;
    highpass.type = "highpass"; highpass.frequency.value = 175; highpass.Q.value = 0.55;
    lowpass.type = "lowpass"; lowpass.frequency.value = 2250; lowpass.Q.value = 0.5;
    toneFilter.type = "lowpass"; toneFilter.frequency.value = 1320; toneFilter.Q.value = 0.42;
    tone.type = "triangle"; tone.frequency.value = note.hz; tone.detune.value = identity.detune;
    body.type = "sine"; body.frequency.value = note.hz;
    body.detune.value = identity.detune + between(-0.8, 0.8);
    toneLevel.gain.value = 0.82; bodyLevel.gain.value = 0.20;
    pluck.gain.value = 0; drone.gain.value = 0;
    throb.type = "sine"; throb.frequency.value = identity.throbHz;
    throbDepth.gain.value = 0; throbBase.gain.value = 0.62;
    noiseFilter.type = "bandpass"; noiseFilter.frequency.value = identity.noiseHz;
    noiseFilter.Q.value = 1.15; noiseLevel.gain.value = 0.72;

    tone.connect(toneLevel).connect(toneFilter);
    body.connect(bodyLevel).connect(toneFilter);
    toneFilter.connect(pluck); toneFilter.connect(drone);
    throb.connect(throbDepth).connect(throbBase.gain);
    drone.connect(throbBase);
    pluck.connect(highpass); throbBase.connect(highpass);
    noiseFilter.connect(noiseLevel).connect(highpass);
    highpass.connect(lowpass).connect(master).connect(context.destination);
    tone.start(); body.start(); throb.start();
    state.sources.push(tone, body, throb);
    return { master, toneFilter, pluck, drone, throbDepth, noiseFilter,
      noiseBuffer: createNoise(context) };
  }

  function hold(param, at) {
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(at);
    else {
      const value = param.value;
      param.cancelScheduledValues(at);
      param.setValueAtTime(value, at);
    }
  }

  function approach(param, value, now, duration = 0.25) {
    hold(param, now);
    param.linearRampToValueAtTime(value, now + duration);
  }

  function pluck(at, level, decay, attack = 0.014) {
    const gain = state.nodes.pluck.gain;
    hold(gain, at);
    gain.linearRampToValueAtTime(level, at + attack);
    gain.exponentialRampToValueAtTime(0.0001, at + decay);
    gain.linearRampToValueAtTime(0, at + decay + 0.03);
  }

  function burst(at, level, duration) {
    const context = state.context;
    const source = context.createBufferSource();
    const envelope = context.createGain();
    source.buffer = state.nodes.noiseBuffer;
    envelope.gain.value = 0;
    source.connect(envelope).connect(state.nodes.noiseFilter);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    envelope.gain.linearRampToValueAtTime(0, at + duration + 0.012);
    source.start(at, between(0, 0.08));
    source.stop(at + duration + 0.03);
    source.onended = () => { source.disconnect(); envelope.disconnect(); };
  }

  function elapsed() {
    return state.context && state.startAt !== null ?
      Math.max(0, state.context.currentTime - state.startAt) : 0;
  }

  function phaseAt(time) {
    if (time >= LENGTH) return "silence";
    if (time >= 145) return "dissolve";
    if (time >= 98) return "throb";
    if (time >= 42) return "divergence";
    return "emergence";
  }

  function nextInterval(time) {
    const steering = 1 + (state.gesture.y - 0.5) * 0.28;
    if (time < 42) return between(4.2, 8.0) * identity.pace * steering;
    if (time < 98) return between(1.7, 3.8) * identity.pace * steering;
    return between(0.28, 0.80) * identity.pace * steering;
  }

  function tick() {
    if (!state.active || !state.context || state.context.state !== "running") return;
    const now = state.context.currentTime;
    const time = elapsed();
    if (time >= LENGTH) { finish(); return; }
    const phase = phaseAt(time);
    if (phase !== state.phase) {
      state.phase = phase;
      ui.field.dataset.score = phase;
      if (phase === "dissolve") state.nextBurst = now + between(0.15, 0.75);
    }

    const g = state.gesture;
    const smoothing = g.touching ? 0.16 : 0.035;
    g.x += (g.targetX - g.x) * smoothing;
    g.y += (g.targetY - g.y) * smoothing;
    if (g.touching || Math.abs(g.x - 0.5) > 0.005 || Math.abs(g.y - 0.5) > 0.005) {
      ui.field.style.setProperty("--touch-x", `${(g.x * 100).toFixed(1)}%`);
      ui.field.style.setProperty("--touch-y", `${(g.y * 100).toFixed(1)}%`);
    }
    const filterShift = (g.x - 0.5) * 330;
    approach(state.nodes.toneFilter.frequency, 1320 + filterShift, now, 0.3);
    approach(state.nodes.noiseFilter.frequency, identity.noiseHz + filterShift * 0.55, now, 0.3);

    let drone = 0;
    let throb = 0;
    if (phase === "divergence" && identity.role === "merge") {
      drone = 0.085 * smooth(42, 93, time);
      throb = 0.07;
    } else if (phase === "throb") {
      drone = identity.role === "merge" ?
        0.085 + 0.007 * smooth(98, 106, time) :
        0.092 * smooth(97, 106, time);
      throb = 0.24 + (g.y - 0.5) * 0.10;
    } else if (phase === "dissolve") {
      drone = 0.092 * (1 - smooth(145, 158, time));
      throb = 0.25;
    }
    approach(state.nodes.drone.gain, drone, now, 0.3);
    approach(state.nodes.throbDepth.gain, throb, now, 0.3);

    if (phase === "emergence" || (phase === "divergence" && identity.role === "bursts")) {
      let emitted = 0;
      while (state.nextPluck <= now + 0.12 && emitted < 2) {
        const split = phase === "divergence";
        const at = Math.max(now, state.nextPluck);
        pluck(at, split ? 0.078 : 0.105,
          split ? between(0.35, 0.78) : between(5.5, 9.0), split ? 0.009 : 0.016);
        if (split && Math.random() < 0.32) burst(at + 0.03, 0.050, 0.17);
        state.nextPluck = at + nextInterval(time);
        emitted += 1;
      }
    }
    if (phase === "dissolve" && time < 179.1) {
      let emitted = 0;
      while (state.nextBurst <= now + 0.12 && emitted < 2) {
        const at = Math.max(now, state.nextBurst);
        const fade = 1 - smooth(164, LENGTH, time);
        burst(at, 0.080 * fade, between(0.10, 0.24));
        state.nextBurst = at + nextInterval(time);
        emitted += 1;
      }
    }
    if (!ui.debug.hidden) updateDebug();
  }

  function showError(message) {
    ui.error.textContent = message;
    ui.error.hidden = false;
    ui.enter.disabled = false;
  }

  function unlock(context) {
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
    const result = context.resume();
    if (result && typeof result.catch === "function") result.catch(() => {});
  }

  function dispose() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    for (const source of state.sources) {
      try { source.stop(); } catch (_) { /* Already stopped. */ }
    }
    state.sources = [];
    if (state.media) { state.media.pause(); state.media.remove(); }
    if (state.mediaUrl) URL.revokeObjectURL(state.mediaUrl);
    state.media = null;
    state.mediaUrl = null;
    if (state.context && state.context.state !== "closed") state.context.close().catch(() => {});
    state.context = null;
    state.nodes = null;
    state.active = false;
  }

  function finish() {
    if (state.finished) return;
    state.finished = true;
    state.phase = "silence";
    ui.field.dataset.score = "silence";
    if (state.debugTimer) clearInterval(state.debugTimer);
    state.debugTimer = null;
    dispose();
    updateDebug();
  }

  async function start() {
    if (state.active || state.starting || state.finished) return;
    if (!Context) { showError("This browser cannot start Web Audio."); return; }
    state.starting = true;
    ui.enter.disabled = true;
    ui.error.hidden = true;
    try {
      configureIOSAudio();
      const context = new Context();
      state.context = context;
      state.nodes = createAudio(context);
      unlock(context); // Keep playback activation inside the ENTRAR click, before any await.
      const deadline = performance.now() + 3000;
      while (context.state !== "running" && performance.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (context.state !== "running") throw new Error(`AudioContext is ${context.state}`);

      const now = context.currentTime;
      state.startAt = now + 0.06;
      state.nextPluck = state.startAt;
      state.nextBurst = Infinity;
      state.active = true;
      state.phase = "emergence";
      ui.enter.hidden = true;
      ui.controls.hidden = false;
      ui.field.classList.add("is-active");
      ui.field.dataset.score = "emergence";
      state.nodes.master.gain.setValueAtTime(0, now);
      state.nodes.master.gain.linearRampToValueAtTime(0.72, now + 0.18);
      tick();
      state.timer = setInterval(tick, 80);
      updateDebug();
    } catch (error) {
      dispose();
      showError(`Audio could not start (${error.message || "unknown error"}). Tap ENTRAR to try again.`);
    } finally { state.starting = false; }
  }

  function toggleMute() {
    if (!state.context || !state.nodes) return;
    if (state.context.state !== "running") {
      const result = state.context.resume();
      if (result && typeof result.catch === "function") result.catch(() => {});
    }
    state.muted = !state.muted;
    approach(state.nodes.master.gain, state.muted ? 0 : 0.72, state.context.currentTime, 0.16);
    ui.mute.textContent = state.muted ? "UNMUTE" : "MUTE";
    ui.mute.setAttribute("aria-pressed", String(state.muted));
  }

  function updateDebug() {
    const seconds = Math.min(LENGTH, Math.floor(elapsed()));
    const values = {
      note: note.name,
      frequency: `${note.hz.toFixed(2)} Hz`,
      register: note.name.endsWith("3") ? "low-mid" : "mid",
      waveform: "triangle + sine",
      resonator: `${identity.noiseHz.toFixed(0)} Hz`,
      filter: "175–2250 Hz, soft",
      session: state.session,
      detune: `${identity.detune.toFixed(2)} cents`,
      modulation: `${identity.throbHz.toFixed(3)} Hz`,
      state: state.context ? state.context.state : state.finished ? "closed" : "not started",
      viewport: `${innerWidth} × ${innerHeight} px`,
      elapsed: `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} / 03:00`,
      mode: "performance",
      phase: state.phase,
      role: identity.role,
      xy: `${state.gesture.x.toFixed(2)}, ${state.gesture.y.toFixed(2)}`,
      agent: navigator.userAgent
    };
    for (const [key, value] of Object.entries(values)) $(`#debug-${key}`).textContent = value;
  }

  function steer(event) {
    if (!state.active || event.target.closest("button, .debug")) return;
    if (event.type === "pointerdown") state.gesture.touching = true;
    if (event.type === "pointermove" && !state.gesture.touching) return;
    state.gesture.targetX = clamp(event.clientX / innerWidth);
    state.gesture.targetY = clamp(event.clientY / innerHeight);
  }

  function releaseGesture() {
    state.gesture.touching = false;
    state.gesture.targetX = 0.5;
    state.gesture.targetY = 0.5;
  }

  ui.field.style.setProperty("--hue", String(note.hue));
  ui.field.style.setProperty("--hue-warm", String((note.hue + 94) % 360));
  ui.field.style.setProperty("--phase", `${identity.phase.toFixed(1)}s`);
  ui.field.style.setProperty("--phase-alt", `${(identity.phase * 1.7).toFixed(1)}s`);
  ui.field.style.setProperty("--phase-veil", `${(identity.phase * 0.44).toFixed(1)}s`);
  ui.enter.addEventListener("click", start);
  ui.mute.addEventListener("click", toggleMute);
  ui.debugToggle.addEventListener("click", () => {
    ui.debug.hidden = !ui.debug.hidden;
    ui.debugToggle.setAttribute("aria-expanded", String(!ui.debug.hidden));
    if (!ui.debug.hidden) {
      updateDebug();
      state.debugTimer = setInterval(updateDebug, 1000);
    } else { clearInterval(state.debugTimer); state.debugTimer = null; }
  });
  ui.field.addEventListener("pointerdown", steer);
  ui.field.addEventListener("pointermove", steer);
  window.addEventListener("pointerup", releaseGesture);
  window.addEventListener("pointercancel", releaseGesture);
  window.addEventListener("blur", releaseGesture);
  document.addEventListener("visibilitychange", () => {
    if (!state.context || state.finished) return;
    if (document.hidden) { state.context.suspend().catch(() => {}); return; }
    const result = state.context.resume();
    if (result && typeof result.catch === "function") result.catch(() => {});
  });
  window.addEventListener("focus", () => {
    if (!state.active || !state.context || state.context.state === "running") return;
    const result = state.context.resume();
    if (result && typeof result.catch === "function") result.catch(() => {});
  });
  window.addEventListener("pageshow", () => {
    if (!state.active || !state.context || state.context.state === "running") return;
    const result = state.context.resume();
    if (result && typeof result.catch === "function") result.catch(() => {});
  });
  window.addEventListener("resize", updateDebug, { passive: true });
})();
