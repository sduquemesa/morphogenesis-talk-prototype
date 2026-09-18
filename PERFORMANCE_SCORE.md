# Three-minute phone score

The root page is now a self-running, approximately three-minute performance instrument. One tap on **ENTRAR** starts a local clock in each phone's `AudioContext`; phones are deliberately not synchronized. The existing `?mode=pulse` experiment has been superseded at the root by this score. The separate, unfinished `instrument/` work is untouched.

| Local time | Movement | Each phone |
| --- | --- | --- |
| 0:00–0:42 | Emergence | An immediate pluck, then long-decay plucks at independent intervals. |
| 0:42–1:38 | Divergence | A random half enters short bursts; the others slowly lengthen into drones. |
| 1:38–2:25 | Collective throb | Every phone converges on a gently pulsing drone. The swell has a loose common phase, with tiny rate differences. |
| 2:25–3:00 | Dissolution | The drone recedes; spaced, soft, resonant noise bursts form a swarm that thins into silence. |

These are three main movements with a dissolution coda, matching the four audible events in the performance brief. The instrument closes its audio context automatically at 3:00. It does not restart without reloading the page.

Touching and moving across the field subtly steers it. Horizontal position shifts a low-pass and resonator center within a narrow range; vertical position slightly biases event spacing and throb depth. Touch never changes the assigned pitch, role, movement, or total duration. The steering eases back toward neutral on release.

The harmonic collection remains C Lydian dominant, weighted toward C, E, F#, G, and Bb. Pitches are kept mainly between 220 and 523 Hz. A gentle high-pass near 175 Hz and low-pass near 1.95 kHz reduce inaudible bass and potentially tiring highs. The final noise passes through a broad band-pass resonator at approximately 520–760 Hz. The instrument now drives its output much harder, with a compressor catching peaks and a separate lift for the short noise bursts. The noise remains present until the last ten seconds, when it fades into silence. Actual speaker loudness still depends on each phone and its media-volume setting. Start a 40-phone room test with low media volume and increase gradually; the collective level may be surprising.

For an estimated 40 active phones, the drone's 2.5-second swell starts on a device-clock boundary. This is not network synchronization: each phone still enters at its own time, with independent pitch, detuning, plucks, bursts, and a tiny variation in swell rate. The shared phase cue makes the room-wide throb less likely to average into a steady drone. The final bursts average about one event every 1.4 seconds per phone, rather than about every half-second, so the collective texture should stay more granular. Device clock differences and room acoustics can still blur either effect.

The score clock follows `AudioContext.currentTime`. When a browser suspends audio, the piece pauses rather than catching up in a burst. iOS still requires a physical-device check for silent-switch behavior, audio-session recovery, speaker output, and the actual room balance. The debug panel shows the movement, role, XY steering, elapsed time, and audio session for troubleshooting.

For a room check, activate 3–5 phones within a few seconds of one another and keep their screens awake. Start with low media volume. Listen at the opening for distinct plucks accumulating spatially, at about 0:42 for two concurrent behaviors, at 1:38 for the shared pulse, and from 2:25 for soft noise swarms and a clean finish. Repeat with at least one iPhone and one Android if available. Record any harshness, inaudible notes, unexpected silence, or missed transitions before inviting a larger group.
