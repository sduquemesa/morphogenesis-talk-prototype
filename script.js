(() => {
  "use strict";

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "pulse" ? "pulse" : "ambient";

  // C Lydian dominant: C D E F# G A Bb. Anchor tones receive more weight.
  const pitchClasses = [
    { name: "C", semitones: 0, weight: 4.6, hue: 188 },
    { name: "D", semitones: 2, weight: 1.4, hue: 207 },
    { name: "E", semitones: 4, weight: 3.7, hue: 36 },
    { name: "F#", semitones: 6, weight: 3.5, hue: 158 },
    { name: "G", semitones: 7, weight: 3.2, hue: 178 },
    { name: "A", semitones: 9, weight: 1.4, hue: 23 },
    { name: "Bb", semitones: 10, weight: 3.0, hue: 272 }
  ];
  const registers = [
    { octave: 3, offset: -12, weight: 1.1 },
    { octave: 4, offset: 0, weight: 4.0 },
    { octave: 5, offset: 12, weight: 1.7 }
  ];
  const timbres = [
    { name: "triangle", type: "triangle", level: 0.88, weight: 3.6 },
    { name: "saw", type: "sawtooth", level: 0.48, weight: 1.7 },
    { name: "square", type: "square", level: 0.48, weight: 1.5 },
    { name: "pulse", type: "custom", level: 0.44, weight: 2.4 }
  ];

  const chooseWeighted = (items) => {
    let cursor = Math.random() * items.reduce((sum, item) => sum + item.weight, 0);
    for (const item of items) {
      cursor -= item.weight;
      if (cursor <= 0) return item;
    }
    return items[items.length - 1];
  };

  const randomBetween = (minimum, maximum) => minimum + Math.random() * (maximum - minimum);
  const pitch = chooseWeighted(pitchClasses);
  const register = chooseWeighted(registers);
  const timbre = chooseWeighted(timbres);
  const detune = randomBetween(-4.2, 4.2);
  const midi = 60 + pitch.semitones + register.offset;
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  const modulationRate = randomBetween(0.018, 0.055);
  const amplitude = randomBetween(0.034, 0.058);
  const filterCenter = Math.min(1120, Math.max(520, frequency * randomBetween(1.9, 2.55)));
  const filterRate = randomBetween(0.006, 0.016);
  const pulseWidthBase = randomBetween(0.26, 0.44);
  const pulseInterval = randomBetween(3.8, 7.2);
  const pulseDuration = randomBetween(0.72, 1.45);
  const initialPulseDelay = randomBetween(0.12, pulseInterval);
  const visualPhase = randomBetween(-140, -4);

  const state = {
    context: null,
    master: null,
    sources: [],
    pulseTimer: null,
    timbreTimer: null,
    currentPulseWidth: pulseWidthBase,
    audioSessionMode: "default",
    mediaUnlock: null,
    mediaUnlockUrl: null,
    startedAt: 0,
    muted: false,
    active: false,
    debugTimer: null
  };

  const elements = {
    field: document.querySelector("#field"),
    enter: document.querySelector("#enter"),
    controls: document.querySelector("#controls"),
    mute: document.querySelector("#mute"),
    debugToggle: document.querySelector("#debug-toggle"),
    debug: document.querySelector("#debug"),
    error: document.querySelector("#error")
  };

  const debugFields = {
    note: document.querySelector("#debug-note"),
    frequency: document.querySelector("#debug-frequency"),
    register: document.querySelector("#debug-register"),
    waveform: document.querySelector("#debug-waveform"),
    width: document.querySelector("#debug-width"),
    filter: document.querySelector("#debug-filter"),
    session: document.querySelector("#debug-session"),
    detune: document.querySelector("#debug-detune"),
    modulation: document.querySelector("#debug-modulation"),
    state: document.querySelector("#debug-state"),
    viewport: document.querySelector("#debug-viewport"),
    elapsed: document.querySelector("#debug-elapsed"),
    mode: document.querySelector("#debug-mode"),
    agent: document.querySelector("#debug-agent")
  };

  const createPulseWave = (context, width) => {
    const harmonics = 24;
    const real = new Float32Array(harmonics + 1);
    const imaginary = new Float32Array(harmonics + 1);

    for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
      const angle = 2 * Math.PI * harmonic * width;
      real[harmonic] = (2 * Math.sin(angle)) / (Math.PI * harmonic);
      imaginary[harmonic] = (2 * (1 - Math.cos(angle))) / (Math.PI * harmonic);
    }

    return context.createPeriodicWave(real, imaginary);
  };

  const isIOS = () => {
    const classicIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const modernIPad = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return classicIOS || modernIPad;
  };

  const createNearSilentWavUrl = () => {
    const sampleRate = 8000;
    const sampleCount = 3200;
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) {
        view.setUint8(offset + index, text.charCodeAt(index));
      }
    };

    writeText(0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, sampleCount * 2, true);

    // One least-significant bit prevents silence optimization while remaining inaudible.
    for (let sample = 0; sample < sampleCount; sample += 1) {
      view.setInt16(44 + sample * 2, sample % 251 === 0 ? 1 : 0, true);
    }

    return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  };

  const startIOSMediaFallback = () => {
    const audio = document.createElement("audio");
    const url = createNearSilentWavUrl();
    audio.src = url;
    audio.loop = true;
    audio.preload = "auto";
    audio.setAttribute("playsinline", "");
    audio.setAttribute("aria-hidden", "true");
    audio.hidden = true;
    document.body.appendChild(audio);
    state.mediaUnlock = audio;
    state.mediaUnlockUrl = url;
    state.audioSessionMode = "media fallback";

    const playResult = audio.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => { state.audioSessionMode = "fallback blocked"; });
    }
  };

  const configureIOSAudioSession = () => {
    if (!isIOS()) return;

    if (navigator.audioSession && "type" in navigator.audioSession) {
      try {
        navigator.audioSession.type = "playback";
        state.audioSessionMode = "playback";
        return;
      } catch (_) {
        // Older or restricted WebKit builds fall through to the media element path.
      }
    }

    startIOSMediaFallback();
  };

  const startPulseWidthMotion = (context, oscillator) => {
    const startedAt = performance.now();
    const widthRange = randomBetween(0.055, 0.095);
    const widthPeriod = randomBetween(41, 83);

    const updateWave = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const width = pulseWidthBase + Math.sin((elapsed / widthPeriod) * Math.PI * 2) * widthRange;
      state.currentPulseWidth = Math.min(0.48, Math.max(0.18, width));
      oscillator.setPeriodicWave(createPulseWave(context, state.currentPulseWidth));
    };

    updateWave();
    state.timbreTimer = window.setInterval(updateWave, 1800);
  };

  const applyVisualIdentity = () => {
    const root = elements.field.style;
    const lightness = 16 + amplitude * 90;
    root.setProperty("--hue", String(pitch.hue + randomBetween(-8, 8)));
    root.setProperty("--hue-warm", String((pitch.hue + 102 + randomBetween(-12, 12)) % 360));
    root.setProperty("--light", `${lightness.toFixed(1)}%`);
    root.setProperty("--field-x", `${randomBetween(34, 66).toFixed(1)}%`);
    root.setProperty("--field-y", `${randomBetween(34, 66).toFixed(1)}%`);
    root.setProperty("--phase", `${visualPhase.toFixed(1)}s`);
    root.setProperty("--phase-alt", `${(visualPhase * 1.71).toFixed(1)}s`);
    root.setProperty("--phase-veil", `${(visualPhase * 0.45).toFixed(1)}s`);
  };

  const createOscillatorVoice = (context, destination) => {
    const voiceMix = context.createGain();
    const primary = context.createOscillator();
    const primaryGain = context.createGain();
    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();
    const drift = context.createOscillator();
    const driftDepth = context.createGain();

    primary.frequency.value = frequency;
    primary.detune.value = detune;
    primaryGain.gain.value = timbre.level;

    if (timbre.type === "custom") {
      startPulseWidthMotion(context, primary);
    } else {
      primary.type = timbre.type;
    }

    overtone.type = "sine";
    overtone.frequency.value = frequency * 2;
    overtone.detune.value = detune + randomBetween(-1.2, 1.2);
    overtoneGain.gain.value = randomBetween(0.035, 0.075);

    drift.type = "sine";
    drift.frequency.value = randomBetween(0.009, 0.026);
    driftDepth.gain.value = randomBetween(0.45, 1.4);

    primary.connect(primaryGain).connect(voiceMix);
    overtone.connect(overtoneGain).connect(voiceMix);
    drift.connect(driftDepth);
    driftDepth.connect(primary.detune);
    driftDepth.connect(overtone.detune);
    voiceMix.connect(destination);

    const now = context.currentTime;
    primary.start(now);
    overtone.start(now);
    drift.start(now);
    state.sources.push(primary, overtone, drift);
  };

  const schedulePulse = () => {
    if (!state.active || !state.context || !state.pulseEnvelope) return;

    const context = state.context;
    const envelope = state.pulseEnvelope.gain;
    const now = context.currentTime;
    const peak = amplitude * randomBetween(0.82, 1.08);
    const attack = Math.min(0.18, pulseDuration * 0.2);
    const releaseStart = now + pulseDuration * 0.46;

    envelope.cancelScheduledValues(now);
    envelope.setValueAtTime(0, now);
    envelope.linearRampToValueAtTime(peak, now + attack);
    envelope.setValueAtTime(peak, releaseStart);
    envelope.exponentialRampToValueAtTime(0.0001, now + pulseDuration - 0.02);
    envelope.linearRampToValueAtTime(0, now + pulseDuration);

    const next = (pulseInterval + randomBetween(-0.16, 0.16)) * 1000;
    state.pulseTimer = window.setTimeout(schedulePulse, next);
  };

  const buildAudioGraph = (context) => {
    const master = context.createGain();
    const safetyFilter = context.createBiquadFilter();
    const bandpass = context.createBiquadFilter();
    const filterLfo = context.createOscillator();
    const filterDepth = context.createGain();
    const modulation = context.createGain();
    const amplitudeLfo = context.createOscillator();
    const amplitudeDepth = context.createGain();

    master.gain.value = 0;
    bandpass.type = "bandpass";
    bandpass.frequency.value = filterCenter;
    bandpass.Q.value = 0.52;
    filterLfo.type = "sine";
    filterLfo.frequency.value = filterRate;
    filterDepth.gain.value = randomBetween(180, 310);
    safetyFilter.type = "lowpass";
    safetyFilter.frequency.value = 2700;
    safetyFilter.Q.value = 0.18;
    modulation.gain.value = 0.88;
    amplitudeLfo.type = "sine";
    amplitudeLfo.frequency.value = modulationRate;
    amplitudeDepth.gain.value = 0.12;

    amplitudeLfo.connect(amplitudeDepth).connect(modulation.gain);
    filterLfo.connect(filterDepth).connect(bandpass.detune);
    modulation.connect(bandpass).connect(safetyFilter).connect(master).connect(context.destination);
    amplitudeLfo.start(context.currentTime);
    filterLfo.start(context.currentTime);
    state.sources.push(amplitudeLfo, filterLfo);
    state.master = master;

    if (mode === "pulse") {
      const envelope = context.createGain();
      envelope.gain.value = 0;
      envelope.connect(modulation);
      state.pulseEnvelope = envelope;
      createOscillatorVoice(context, envelope);
    } else {
      const voiceLevel = context.createGain();
      voiceLevel.gain.value = amplitude;
      voiceLevel.connect(modulation);
      createOscillatorVoice(context, voiceLevel);
    }
  };

  const unlockAudioContext = (context) => {
    // Starting a silent buffer inside the click improves WebKit's first-play reliability.
    const buffer = context.createBuffer(1, 1, context.sampleRate);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
  };

  const waitForRunning = async (context, timeout = 2800) => {
    const deadline = performance.now() + timeout;
    while (context.state !== "running" && performance.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return context.state === "running";
  };

  const requestFullscreen = () => {
    const target = document.documentElement;
    const request = target.requestFullscreen || target.webkitRequestFullscreen;
    if (request) {
      try {
        const result = request.call(target);
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch (_) {
        // Fullscreen is an enhancement; iPhone Safari may not expose this API.
      }
    }
  };

  const start = async () => {
    if (state.active) return;
    elements.error.hidden = true;

    if (!AudioContextClass) {
      showError("Web Audio is not supported by this browser. Try a recent version of Safari or Chrome.");
      return;
    }

    try {
      configureIOSAudioSession();
      const context = new AudioContextClass();
      state.context = context;
      context.addEventListener("statechange", updateDebug);
      unlockAudioContext(context);
      buildAudioGraph(context);
      let resumeError = null;
      const resumeResult = context.resume();
      if (resumeResult && typeof resumeResult.catch === "function") {
        resumeResult.catch((error) => { resumeError = error; });
      }
      // Audio gets the gesture first; fullscreen remains a best-effort enhancement.
      requestFullscreen();

      if (!(await waitForRunning(context))) {
        throw resumeError || new Error(`AudioContext remained ${context.state}`);
      }

      state.active = true;
      state.startedAt = performance.now();
      elements.enter.classList.add("is-leaving");
      elements.field.classList.add("is-active");
      elements.controls.hidden = false;

      window.setTimeout(() => {
        elements.enter.hidden = true;
      }, 1450);

      const now = context.currentTime;
      state.master.gain.cancelScheduledValues(now);
      state.master.gain.setValueAtTime(0, now);
      state.master.gain.linearRampToValueAtTime(0.82, now + (mode === "pulse" ? 0.8 : 4.5));

      if (mode === "pulse") {
        state.pulseTimer = window.setTimeout(schedulePulse, initialPulseDelay * 1000);
      }
      updateDebug();
    } catch (error) {
      cleanupAudio();
      showError(`Audio could not start (${error.message || "unknown error"}). Tap ENTRAR to try again.`);
    }
  };

  const cleanupAudio = () => {
    state.active = false;
    if (state.pulseTimer) window.clearTimeout(state.pulseTimer);
    if (state.timbreTimer) window.clearInterval(state.timbreTimer);
    state.pulseTimer = null;
    state.timbreTimer = null;
    for (const source of state.sources) {
      try { source.stop(); } catch (_) { /* Already stopped. */ }
    }
    state.sources = [];
    if (state.mediaUnlock) {
      state.mediaUnlock.pause();
      state.mediaUnlock.remove();
      state.mediaUnlock = null;
    }
    if (state.mediaUnlockUrl) {
      URL.revokeObjectURL(state.mediaUnlockUrl);
      state.mediaUnlockUrl = null;
    }
    if (state.context && state.context.state !== "closed") state.context.close().catch(() => {});
    state.context = null;
    state.master = null;
  };

  const showError = (message) => {
    elements.error.textContent = message;
    elements.error.hidden = false;
    elements.enter.classList.remove("is-leaving");
    elements.enter.hidden = false;
  };

  const toggleMute = async () => {
    if (!state.context || !state.master) return;
    if (state.context.state !== "running") await state.context.resume();

    state.muted = !state.muted;
    const now = state.context.currentTime;
    state.master.gain.cancelScheduledValues(now);
    state.master.gain.setValueAtTime(Math.max(state.master.gain.value, 0.0001), now);
    state.master.gain.exponentialRampToValueAtTime(state.muted ? 0.0001 : 0.82, now + 0.12);
    elements.mute.textContent = state.muted ? "UNMUTE" : "MUTE";
    elements.mute.setAttribute("aria-pressed", String(state.muted));
  };

  const formatElapsed = () => {
    if (!state.startedAt) return "00:00";
    const totalSeconds = Math.floor((performance.now() - state.startedAt) / 1000);
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  const updateDebug = () => {
    debugFields.note.textContent = `${pitch.name}${register.octave}`;
    debugFields.frequency.textContent = `${frequency.toFixed(2)} Hz`;
    debugFields.register.textContent = `octave ${register.octave}`;
    debugFields.waveform.textContent = timbre.name;
    debugFields.width.textContent = timbre.name === "pulse" ? `${(state.currentPulseWidth * 100).toFixed(1)}%` : "—";
    debugFields.filter.textContent = `${filterCenter.toFixed(0)} Hz · ${filterRate.toFixed(3)} Hz`;
    debugFields.session.textContent = state.audioSessionMode;
    debugFields.detune.textContent = `${detune >= 0 ? "+" : ""}${detune.toFixed(2)} cents`;
    debugFields.modulation.textContent = `${modulationRate.toFixed(3)} Hz`;
    debugFields.state.textContent = state.context ? state.context.state : "not created";
    debugFields.viewport.textContent = `${window.innerWidth} × ${window.innerHeight} px`;
    debugFields.elapsed.textContent = formatElapsed();
    debugFields.mode.textContent = mode;
    debugFields.agent.textContent = navigator.userAgent;
  };

  const toggleDebug = () => {
    const opening = elements.debug.hidden;
    elements.debug.hidden = !opening;
    elements.debugToggle.setAttribute("aria-expanded", String(opening));
    if (opening) {
      updateDebug();
      state.debugTimer = window.setInterval(updateDebug, 1000);
    } else if (state.debugTimer) {
      window.clearInterval(state.debugTimer);
      state.debugTimer = null;
    }
  };

  const recoverAudio = () => {
    if (document.visibilityState === "visible" && state.active && !state.muted && state.context && state.context.state !== "running" && state.context.state !== "closed") {
      const resumeResult = state.context.resume();
      if (resumeResult && typeof resumeResult.catch === "function") resumeResult.catch(() => {});
    }
    updateDebug();
  };

  applyVisualIdentity();
  elements.enter.addEventListener("click", start);
  elements.mute.addEventListener("click", () => {
    toggleMute().catch((error) => {
      showError(`Audio could not resume (${error.message || "unknown error"}). Tap UNMUTE to try again.`);
    });
  });
  elements.debugToggle.addEventListener("click", toggleDebug);
  document.addEventListener("visibilitychange", recoverAudio);
  window.addEventListener("pageshow", recoverAudio);
  window.addEventListener("focus", recoverAudio);
  window.addEventListener("resize", updateDebug, { passive: true });
})();
