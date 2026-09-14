# Morphogenesis — distributed phone field test

This static prototype tests a simple question for the lecture-performance **Morphogenesis**: can several independent audience phones, each producing one restrained sound/light state, form a convincing emergent audiovisual field in a physical room?

Each visit randomly gives the phone one incomplete musical voice and a related slow visual field. There is no backend, tracking, device communication, or synchronization. The differences between phones—their start times, speaker responses, oscillator phases, and physical positions—are the material of the test.

## Run locally

The project has no dependencies or build step. Serve the directory over HTTP rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
```

Then visit:

- Ambient: `http://localhost:8000/`
- Pulse: `http://localhost:8000/?mode=pulse`

For testing on a physical phone, GitHub Pages is the easiest HTTPS host. A local computer address such as `http://192.168.1.10:8000` may not be treated as a secure context by every mobile browser, although Web Audio itself will often still work.

## Deploy to GitHub Pages

The repository is `https://github.com/sduquemesa/morphogenesis-talk-prototype`.

For the initial push from this directory, run:

```sh
git init
git add .nojekyll index.html style.css script.js README.md
git commit -m "Add Morphogenesis field test"
git branch -M main
git remote add origin https://github.com/sduquemesa/morphogenesis-talk-prototype.git
git push -u origin main
```

Then configure Pages:

1. On GitHub, open the repository and go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch **main**, folder **/(root)**, then click **Save**.
4. After GitHub finishes publishing, open `https://sduquemesa.github.io/morphogenesis-talk-prototype/`.
5. Pulse mode is `https://sduquemesa.github.io/morphogenesis-talk-prototype/?mode=pulse`.

No GitHub Actions workflow or build command is required.

## Mobile browser limitations

- Audio can start only after the user taps **ENTRAR**. The page creates and resumes its `AudioContext` inside that tap handler.
- iPhone Safari may not allow a normal webpage to enter true fullscreen. The page still fills the available viewport and uses safe-area insets. On iOS 17 and later the prototype requests the `playback` audio-session type so Web Audio remains audible with the Ring/Silent switch engaged. Older iOS versions receive a generated near-silent media-element fallback; no external sound file is loaded.
- Safari also has known Web Audio interruption/resume edge cases, especially when a page is installed to the Home Screen; test first in a normal Safari tab.
- Locking the screen, changing apps, Low Power Mode, or browser memory pressure can suspend audio and slow animation. The page attempts to resume previously unlocked audio when it becomes visible again, but some Safari sessions may require another tap (the mute control can provide it).
- Phone speakers differ greatly. Their automatic gain control, frequency response, stereo layout, volume setting, and case position will change the balance. Avoid maximum volume.
- Browser timers can be throttled when a tab is backgrounded. Keep the page visible during pulse tests.
- The page requests no microphone, camera, location, Bluetooth, motion, or notification permissions.

## Harmonic logic

The fixed collection is **C Lydian dominant**:

`C · D · E · F# · G · A · Bb`

Every session chooses one pitch class and one register. C, E, F#, G, and Bb are weighted more heavily so a group tends to assemble the root, major third, #11, fifth, and minor seventh of a suspended dominant field. D and A occur less often as color tones. Registers span octaves 3–5, with octave 4 favored so small phone speakers remain useful.

Each pitch receives a small random detuning. The primary oscillator is weighted toward triangle but may instead be a restrained saw, square, or custom pulse wave. Pulse-wave sessions slowly change duty cycle. An extremely soft sine overtone adds depth. A broad, slowly moving band-pass and a final low-pass reduce weak phone-speaker lows and tame tiring high frequencies. Very slow amplitude modulation, subtle pitch drift, and a gentle fade-in keep the sound in motion. One phone should sound partial; several phones supply harmonic density, beating, and spatial distribution.

The pitch choice also influences hue. Loudness, modulation phase, and independent random values influence luminosity and the positions/timing of the slow gradient fields.

## Modes

**Ambient (default)** holds the assigned tone continuously. Independent modulation and small detuning create slow collective beating.

**Pulse (`?mode=pulse`)** uses the same pitch assignment but reveals it with a soft, short tone every 3.8–7.2 seconds. Each session has a different initial phase, interval, duration, and slight timing variation, making temporal smearing audible across a group.

## Venue testing procedure (3–5 phones)

Set media volume conservatively before beginning. Keep every phone's page visible and disable auto-lock for the duration of the test if practical.

### TEST A — Individual device

- open page
- tap ENTRAR
- confirm sound begins
- confirm visual field evolves
- confirm mute works

### TEST B — Distributed ambient field

- open on 3–5 phones
- activate phones approximately together
- place them several feet apart
- listen for harmonic beating and spatial distribution
- dim room lights and observe visual field

### TEST C — Temporal distribution

- open `?mode=pulse` on 3–5 phones
- activate approximately together
- listen for timing differences and temporal smearing

### TEST D — Device heterogeneity

- test at least one iPhone and one Android device if available
- compare loudness, pitch behavior, and browser reliability

Use **DIAG** in the lower-right corner to compare each session's note, frequency, register, detuning, modulation rate, audio state, viewport, elapsed time, mode, and browser user agent. The panel is hidden by default.

## Practical limits of this prototype

There is deliberately no calibration, master clock, group volume control, or network coordination. A random group can overrepresent one note, and different device speakers can make equal Web Audio levels sound unequal. Those are useful findings for this venue test rather than problems hidden by extra infrastructure.
