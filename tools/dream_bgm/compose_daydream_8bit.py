import os
import subprocess
import numpy as np
from scipy.signal import butter, filtfilt, lfilter
from scipy.io import wavfile

SR = 44100
BPM = 104.0
BEAT = 60.0 / BPM  # ~0.5769s per quarter note

OUT_DIR = "./output"
INT_DIR = "./output"
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(INT_DIR, exist_ok=True)

NOTE_MAP = {
    'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
    'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
}

def note_to_freq(note_str):
    if note_str is None or note_str == 'R':
        return 0.0
    if len(note_str) >= 2 and note_str[1] in ('#', 'b'):
        name, octave = note_str[:2], int(note_str[2:])
    else:
        name, octave = note_str[0], int(note_str[1:])
    midi = (octave + 1) * 12 + NOTE_MAP[name]
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

def make_adsr(n_samples, sr, attack=0.010, decay=0.14, sustain=0.45, release=0.09, exp_decay=1.2):
    env = np.ones(n_samples, dtype=np.float64) * sustain
    a_n = min(int(attack * sr), n_samples)
    d_n = min(int(decay * sr), max(0, n_samples - a_n))
    r_n = min(int(release * sr), n_samples)
    if a_n > 0:
        env[:a_n] = np.linspace(0.0, 1.0, a_n, endpoint=False)
    if d_n > 0:
        t_d = np.linspace(0.0, 1.0, d_n, endpoint=False)
        env[a_n:a_n + d_n] = sustain + (1.0 - sustain) * ((1.0 - t_d) ** 1.6)
    if exp_decay > 0 and n_samples > a_n + d_n:
        t_s = np.arange(n_samples - (a_n + d_n)) / sr
        env[a_n + d_n:] *= np.exp(-t_s * exp_decay)
    if r_n > 0:
        rel_start = max(0, n_samples - r_n)
        env[rel_start:] *= np.linspace(1.0, 0.0, n_samples - rel_start)
    return env

def synth_pulse(freq, dur_sec, duty=0.25, amp=0.25, attack=0.008, decay=0.14,
                sustain=0.46, release=0.08, exp_decay=0.95,
                vibrato_hz=5.0, vibrato_cents=6.0, vibrato_delay=0.26):
    n = int(round(dur_sec * SR))
    if n <= 0 or freq <= 0:
        return np.zeros(max(0, n), dtype=np.float64)
    t = np.arange(n) / SR
    if vibrato_cents > 0 and dur_sec > vibrato_delay + 0.06:
        vib_env = np.clip((t - vibrato_delay) / 0.20, 0.0, 1.0)
        vib = 2.0 ** ((vibrato_cents * vib_env * np.sin(2.0 * np.pi * vibrato_hz * t)) / 1200.0)
        inst_freq = freq * vib
    else:
        inst_freq = np.full(n, freq, dtype=np.float64)
    phase = np.cumsum(inst_freq / SR) % 1.0
    wave = np.where(phase < duty, 1.0, -1.0) - (2.0 * duty - 1.0)
    cutoff = 5400.0 if freq < 900.0 else 4200.0
    b, a = butter(2, min(cutoff / (SR / 2.0), 0.95), btype='low')
    wave = lfilter(b, a, wave)
    pitch_comp = 1.0 if freq < 900.0 else max(0.74, (900.0 / freq) ** 0.45)
    env = make_adsr(n, SR, attack=attack, decay=decay, sustain=sustain,
                    release=release, exp_decay=exp_decay)
    return wave * env * amp * pitch_comp

def synth_nes_triangle(freq, dur_sec, amp=0.28, attack=0.03, decay=0.08,
                       sustain=0.88, release=0.14):
    n = int(round(dur_sec * SR))
    if n <= 0 or freq <= 0:
        return np.zeros(max(0, n), dtype=np.float64)
    t = np.arange(n) / SR
    phase = (freq * t) % 1.0
    tri = 2.0 * np.abs(2.0 * phase - 1.0) - 1.0
    tri_q = np.round(tri * 7.5) / 7.5
    env = make_adsr(n, SR, attack=attack, decay=decay, sustain=sustain,
                    release=release, exp_decay=0.18)
    return tri_q * env * amp

def synth_pad_chord(notes, dur_sec, amp=0.11, duty=0.50, attack=0.26, release=0.38):
    n = int(round(dur_sec * SR))
    if n <= 0:
        return np.zeros(0, dtype=np.float64)
    buf = np.zeros(n, dtype=np.float64)
    t = np.arange(n) / SR
    for idx, note in enumerate(notes):
        f = note_to_freq(note)
        if f <= 0:
            continue
        detune = 1.0 + (idx - (len(notes) - 1) / 2.0) * 0.0007
        phase = (f * detune * t) % 1.0
        sq = np.where(phase < duty, 1.0, -1.0) - (2.0 * duty - 1.0)
        tri = np.round((2.0 * np.abs(2.0 * phase - 1.0) - 1.0) * 7.5) / 7.5
        voice = 0.22 * sq + 0.78 * tri
        buf += voice / max(1, len(notes) ** 0.65)
    b, a = butter(2, 1850.0 / (SR / 2.0), btype='low')
    buf = filtfilt(b, a, buf)
    env = make_adsr(n, SR, attack=attack, decay=0.18, sustain=0.80,
                    release=release, exp_decay=0.15)
    return buf * env * amp

def synth_chime(freq, dur_sec, amp=0.15):
    n = int(round(dur_sec * SR))
    if n <= 0 or freq <= 0:
        return np.zeros(max(0, n), dtype=np.float64)
    t = np.arange(n) / SR
    phase = (freq * t) % 1.0
    sq = np.where(phase < 0.5, 1.0, -1.0)
    tri = 2.0 * np.abs(2.0 * phase - 1.0) - 1.0
    wave = 0.45 * sq + 0.55 * tri
    b, a = butter(2, 4200.0 / (SR / 2.0), btype='low')
    wave = lfilter(b, a, wave)
    env = np.exp(-t * 3.0) * make_adsr(n, SR, attack=0.005, decay=0.04, sustain=0.95,
                                       release=0.08, exp_decay=0.0)
    return wave * env * amp

def add_to_track(track, signal, start_beat):
    start_idx = int(round(start_beat * BEAT * SR))
    end_idx = start_idx + len(signal)
    if start_idx < 0:
        return
    if end_idx > len(track):
        signal = signal[:len(track) - start_idx]
        end_idx = len(track)
    if len(signal) > 0:
        track[start_idx:end_idx] += signal

# =============================================================================
# MUSICAL COMPOSITION — "Sunlit Daydream (8-Bit)" (Extended & Tightened Cutout)
# Key: G Major | 4/4 | 104 BPM | 62 Bars = 248 Beats (~146.6s / 2:27)
#
# Structure:
#   Bars  1 -  8 (beats   0 -  32, 0:00–0:18): Intro — Sustained chords + sparse chimes
#   Bars  9 - 16 (beats  32 -  64, 0:18–0:37): Section A — Simple, breezy daydream theme
#   Bars 17 - 24 (beats  64 -  96, 0:37–0:55): Section A' — Progressive lift + soft harmony
#   Bars 25 - 32 (beats  96 - 128, 0:55–1:14): Section B — Floating cloudlike bridge
#   Bars 33 - 36 (beats 128 - 144, 1:14–1:23): ★ COMPACT 4-BAR UNACCOMPANIED CUTOUT ★
#                                              Accelerates & climbs straight to peak,
#                                              then IMMEDIATELY drops back into warm
#                                              accompaniment & relaxed singing tempo!
#   Bars 37 - 44 (beats 144 - 176, 1:23–1:42): Section C — Radiant high-octave climax
#   Bars 45 - 52 (beats 176 - 208, 1:42–2:00): Section A'' — Warm gentle reprise
#   Bars 53 - 62 (beats 208 - 248, 2:00–2:27): Outro — Sparse drifting chimes & fade
# =============================================================================
TOTAL_BEATS = 248
TAIL_SEC = 3.5
TOTAL_SAMPLES = int(round((TOTAL_BEATS * BEAT + TAIL_SEC) * SR))

lead_L = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
lead_R = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
pad_L = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
pad_R = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
bass_M = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
harm_L = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
harm_R = np.zeros(TOTAL_SAMPLES, dtype=np.float64)

def place_stereo(buf_L, buf_R, sig, start_beat, pan=0.0):
    g_L = np.sqrt(0.5 * (1.0 - pan))
    g_R = np.sqrt(0.5 * (1.0 + pan))
    add_to_track(buf_L, sig * g_L, start_beat)
    add_to_track(buf_R, sig * g_R, start_beat)

def add_accompaniment(prog):
    for sb, db, b_note, c_notes, p_amp, b_amp in prog:
        dur_s = db * BEAT
        if c_notes:
            p_sig = synth_pad_chord(c_notes, dur_s + 0.16, amp=p_amp, duty=0.50, attack=0.24, release=0.38)
            place_stereo(pad_L, pad_R, p_sig, sb, pan=-0.12)
            if len(c_notes) >= 3:
                p_hi = synth_pad_chord(c_notes[-2:], dur_s + 0.16, amp=p_amp * 0.40, duty=0.25, attack=0.30, release=0.38)
                place_stereo(pad_L, pad_R, p_hi, sb, pan=0.18)
        if b_note:
            b_sig = synth_nes_triangle(note_to_freq(b_note), dur_s + 0.05, amp=b_amp, attack=0.035, release=0.16)
            add_to_track(bass_M, b_sig, sb)

def add_melody_events(events, base_beat=0.0, use_chime=False, fast_bounce=False):
    for item in events:
        bo, db, note = item[0], item[1], item[2]
        duty = item[3] if len(item) > 3 else 0.25
        amp = item[4] if len(item) > 4 else 0.26
        pan = item[5] if len(item) > 5 else 0.04
        legato = item[6] if len(item) > 6 else 0.90
        vib = item[7] if len(item) > 7 else 6.0
        if note is None or note == 'R':
            continue
        f = note_to_freq(note)
        dur_s = db * BEAT * legato
        if use_chime:
            sig = synth_chime(f, max(dur_s, 0.50), amp=amp)
        else:
            att = 0.005 if db <= 0.5 else 0.009
            rel = 0.035 if db <= 0.5 else 0.08
            sus = 0.38 if fast_bounce else 0.48
            dec = 0.08 if fast_bounce else 0.15
            exp_d = 1.6 if fast_bounce else 0.95
            sig = synth_pulse(f, dur_s, duty=duty, amp=amp, attack=att, decay=dec,
                              sustain=sus, release=rel, exp_decay=exp_d, vibrato_cents=vib)
        place_stereo(lead_L, lead_R, sig, base_beat + bo, pan=pan)

# -----------------------------------------------------------------------------
# 1. INTRO: Bars 1–8 (Beats 0–32)
# -----------------------------------------------------------------------------
intro_prog = [
    (0,  8, 'G2', ['G3', 'B3', 'D4', 'F#4'], 0.12, 0.21),
    (8,  8, 'E2', ['E3', 'B3', 'D4', 'G4'],  0.12, 0.21),
    (16, 8, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.13, 0.22),
    (24, 8, 'D2', ['D3', 'A3', 'C4', 'F#4'], 0.13, 0.22),
]
add_accompaniment(intro_prog)

intro_chimes = [
    (2.0,  2.0, 'D5', 0.5, 0.16, -0.15),
    (5.0,  2.5, 'F#5', 0.5, 0.16, 0.15),
    (10.0, 2.0, 'B4', 0.5, 0.16, -0.15),
    (13.0, 2.5, 'E5', 0.5, 0.17, 0.15),
    (18.0, 2.0, 'G5', 0.5, 0.17, -0.12),
    (21.0, 2.5, 'E5', 0.5, 0.17, 0.12),
    (26.0, 2.0, 'F#5', 0.5, 0.17, -0.10),
    (29.0, 2.5, 'A5', 0.5, 0.18, 0.10),
]
add_melody_events(intro_chimes, base_beat=0.0, use_chime=True)

# -----------------------------------------------------------------------------
# 2. SECTION A: Bars 9–16 (Beats 32–64)
# -----------------------------------------------------------------------------
secA_prog = [
    (32, 4, 'G2', ['G3', 'B3', 'D4', 'F#4'], 0.14, 0.25),
    (36, 4, 'B2', ['B3', 'D4', 'F#4', 'A4'], 0.14, 0.25),
    (40, 4, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.14, 0.25),
    (44, 4, 'D3', ['D4', 'F#4', 'A4', 'E5'], 0.14, 0.25),
    (48, 4, 'E2', ['E3', 'G3', 'B3', 'D4'],  0.14, 0.25),
    (52, 4, 'B2', ['B3', 'D4', 'F#4', 'A4'], 0.14, 0.25),
    (56, 4, 'A2', ['A3', 'C4', 'E4', 'G4'],  0.14, 0.25),
    (60, 4, 'D2', ['D3', 'A3', 'C4', 'F#4'], 0.14, 0.25),
]
add_accompaniment(secA_prog)

secA_melody = [
    (0.0,  1.5, 'B4', 0.25, 0.27),
    (1.5,  0.5, 'D5', 0.25, 0.25),
    (2.0,  1.0, 'G5', 0.25, 0.28),
    (3.0,  1.0, 'F#5', 0.25, 0.26),

    (4.0,  1.5, 'D5', 0.25, 0.27),
    (5.5,  0.5, 'B4', 0.25, 0.24),
    (6.0,  2.0, 'A4', 0.25, 0.25),

    (8.0,  1.5, 'G4', 0.25, 0.25),
    (9.5,  0.5, 'B4', 0.25, 0.25),
    (10.0, 1.0, 'E5', 0.25, 0.28),
    (11.0, 1.0, 'D5', 0.25, 0.26),

    (12.0, 2.5, 'A4', 0.25, 0.25),
    (14.5, 0.5, 'B4', 0.25, 0.24),
    (15.0, 1.0, 'D5', 0.25, 0.26),

    (16.0, 1.5, 'G5', 0.25, 0.28),
    (17.5, 0.5, 'F#5', 0.25, 0.26),
    (18.0, 1.0, 'E5', 0.25, 0.27),
    (19.0, 1.0, 'D5', 0.25, 0.26),

    (20.0, 1.5, 'F#5', 0.25, 0.28),
    (21.5, 0.5, 'E5', 0.25, 0.26),
    (22.0, 2.0, 'D5', 0.25, 0.26),

    (24.0, 1.0, 'C5', 0.25, 0.26),
    (25.0, 1.0, 'E5', 0.25, 0.27),
    (26.0, 1.0, 'G5', 0.25, 0.29),
    (27.0, 1.0, 'E5', 0.25, 0.26),

    (28.0, 2.5, 'F#5', 0.25, 0.28),
    (30.5, 0.5, 'E5', 0.25, 0.25),
    (31.0, 1.0, 'D5', 0.25, 0.26),
]
add_melody_events(secA_melody, base_beat=32.0)

# -----------------------------------------------------------------------------
# 3. SECTION A': Bars 17–24 (Beats 64–96)
# -----------------------------------------------------------------------------
secA2_prog = [
    (64, 4, 'G2', ['G3', 'B3', 'D4', 'F#4'], 0.15, 0.26),
    (68, 4, 'B2', ['B3', 'D4', 'F#4', 'A4'], 0.15, 0.26),
    (72, 4, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.15, 0.26),
    (76, 4, 'A2', ['A3', 'C#4', 'E4', 'G4'], 0.15, 0.26),
    (80, 4, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.15, 0.26),
    (84, 4, 'G2', ['G3', 'B3', 'D4', 'G4'],  0.15, 0.26),
    (88, 4, 'A2', ['A3', 'C4', 'E4', 'G4'],  0.15, 0.26),
    (92, 4, 'D2', ['D3', 'F#3', 'A3', 'D4'], 0.15, 0.26),
]
add_accompaniment(secA2_prog)

secA2_melody = [
    (0.0,  1.5, 'B4', 0.25, 0.27),
    (1.5,  0.5, 'D5', 0.25, 0.26),
    (2.0,  1.0, 'G5', 0.25, 0.29),
    (3.0,  1.0, 'A5', 0.25, 0.29),

    (4.0,  1.5, 'F#5', 0.25, 0.28),
    (5.5,  0.5, 'D5', 0.25, 0.26),
    (6.0,  2.0, 'B4', 0.25, 0.26),

    (8.0,  1.0, 'E5', 0.25, 0.27),
    (9.0,  1.0, 'G5', 0.25, 0.29),
    (10.0, 1.0, 'F#5', 0.25, 0.28),
    (11.0, 1.0, 'E5', 0.25, 0.27),

    (12.0, 1.5, 'E5', 0.25, 0.28),
    (13.5, 0.5, 'C#5', 0.25, 0.27),
    (14.0, 2.0, 'A5', 0.25, 0.29),

    (16.0, 1.5, 'G5', 0.25, 0.29),
    (17.5, 0.5, 'E5', 0.25, 0.27),
    (18.0, 1.0, 'D5', 0.25, 0.27),
    (19.0, 1.0, 'E5', 0.25, 0.27),

    (20.0, 1.5, 'D5', 0.25, 0.27),
    (21.5, 0.5, 'B4', 0.25, 0.26),
    (22.0, 2.0, 'G5', 0.25, 0.29),

    (24.0, 1.0, 'E5', 0.25, 0.27),
    (25.0, 1.0, 'D5', 0.25, 0.27),
    (26.0, 1.0, 'C5', 0.25, 0.27),
    (27.0, 1.0, 'E5', 0.25, 0.27),

    (28.0, 2.5, 'D5', 0.25, 0.27),
    (30.5, 0.5, 'B4', 0.25, 0.25),
    (31.0, 1.0, 'D5', 0.25, 0.26),
]
add_melody_events(secA2_melody, base_beat=64.0)

secA2_harm = [
    (0.0,  4.0, 'D4'),
    (4.0,  4.0, 'F#4'),
    (8.0,  4.0, 'G4'),
    (12.0, 4.0, 'G4'),
    (16.0, 4.0, 'B4'),
    (20.0, 4.0, 'B4'),
    (24.0, 4.0, 'G4'),
    (28.0, 4.0, 'A4'),
]
for bo, db, note in secA2_harm:
    sig = synth_nes_triangle(note_to_freq(note), db * BEAT * 0.94, amp=0.095,
                             attack=0.09, decay=0.12, sustain=0.72, release=0.16)
    place_stereo(harm_L, harm_R, sig, 64.0 + bo, pan=-0.22)

# -----------------------------------------------------------------------------
# 4. SECTION B: Bars 25–32 (Beats 96–128) — Dreamy, floating cloudlike bridge
#    Unhurried, airy harmonic wander (IV -> iii -> ii -> I) building gentle
#    daydream anticipation right before the accompaniment drops away!
# -----------------------------------------------------------------------------
secB_prog = [
    (96,  4, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.145, 0.25),  # Cmaj7
    (100, 4, 'B2', ['B3', 'D4', 'F#4', 'A4'], 0.145, 0.25),  # Bm7
    (104, 4, 'A2', ['A3', 'C4', 'E4', 'G4'],  0.145, 0.25),  # Am7
    (108, 4, 'G2', ['G3', 'B3', 'D4', 'F#4'], 0.145, 0.25),  # Gmaj7
    (112, 4, 'C3', ['C4', 'E4', 'G4', 'D5'],  0.145, 0.25),  # Cadd9
    (116, 4, 'E2', ['E3', 'G3', 'B3', 'D4'],  0.145, 0.25),  # Em7
    (120, 4, 'A2', ['A3', 'C4', 'E4', 'G4'],  0.140, 0.24),  # Am7
    (124, 4, 'D2', ['D3', 'F#3', 'A3', 'D4'], 0.130, 0.23),  # D (clean breath before cutout)
]
add_accompaniment(secB_prog)

secB_melody = [
    # Bar 25 (Cmaj7) — Drifting, airy phrasing
    (0.0,  2.0, 'E5', 0.25, 0.27),
    (2.0,  1.0, 'G5', 0.25, 0.28),
    (3.0,  1.0, 'B5', 0.25, 0.29),
    # Bar 26 (Bm7)
    (4.0,  2.0, 'A5', 0.25, 0.28),
    (6.0,  1.0, 'F#5',0.25, 0.27),
    (7.0,  1.0, 'D5', 0.25, 0.26),
    # Bar 27 (Am7)
    (8.0,  1.5, 'E5', 0.25, 0.27),
    (9.5,  0.5, 'G5', 0.25, 0.27),
    (10.0, 2.0, 'E5', 0.25, 0.27),
    # Bar 28 (Gmaj7)
    (12.0, 2.5, 'D5', 0.25, 0.26),
    (14.5, 0.5, 'E5', 0.25, 0.25),
    (15.0, 1.0, 'G5', 0.25, 0.27),
    # Bar 29 (Cadd9)
    (16.0, 2.0, 'G5', 0.25, 0.28),
    (18.0, 1.0, 'E5', 0.25, 0.27),
    (19.0, 1.0, 'D5', 0.25, 0.26),
    # Bar 30 (Em7)
    (20.0, 2.0, 'B4', 0.25, 0.26),
    (22.0, 1.0, 'D5', 0.25, 0.26),
    (23.0, 1.0, 'G5', 0.25, 0.28),
    # Bar 31 (Am7)
    (24.0, 1.5, 'E5', 0.25, 0.27),
    (25.5, 0.5, 'D5', 0.25, 0.26),
    (26.0, 2.0, 'C5', 0.25, 0.26),
    # Bar 32 (D) — Clean upward step into the unaccompanied cutout!
    (28.0, 2.5, 'D5', 0.25, 0.27),
    (30.5, 0.5, 'E5', 0.25, 0.26),
    (31.0, 1.0, 'F#5',0.25, 0.27),
]
add_melody_events(secB_melody, base_beat=96.0)

# Gentle sparse chimes echoing in Section B
secB_chimes = [
    (4.0,  2.5, 'D6', 0.5, 0.11, -0.22),
    (12.0, 2.5, 'B5', 0.5, 0.11,  0.22),
    (20.0, 2.5, 'E6', 0.5, 0.11, -0.22),
]
add_melody_events(secB_chimes, base_beat=96.0, use_chime=True)

# -----------------------------------------------------------------------------
# 5. ★ COMPACT 4-BAR UNACCOMPANIED CUTOUT & RISING PEAK ★
#    Bars 33–36 (Beats 128–144, ~9.2s): ZERO pad, ZERO bass!
#    Starts crisp & playful, accelerates into 16th-note starlight climb, and
#    the MOMENT pitch & speed hit the peak at the end of Bar 36, Bar 37
#    immediately brings the warm sustained accompaniment back in & slows down!
# -----------------------------------------------------------------------------
cutout_melody = [
    # Bar 33: Sudden open air! Crisp bouncy 8th-note motif
    (0.0,  0.5, 'G5', 0.25, 0.29, 0.0, 0.80, 0.0),
    (0.5,  0.5, 'A5', 0.25, 0.27, 0.0, 0.80, 0.0),
    (1.0,  0.5, 'B5', 0.25, 0.30, 0.0, 0.80, 0.0),
    (1.5,  0.5, 'D5', 0.25, 0.26, 0.0, 0.80, 0.0),
    (2.0,  0.5, 'G5', 0.25, 0.29, 0.0, 0.80, 0.0),
    (2.5,  0.5, 'A5', 0.25, 0.28, 0.0, 0.80, 0.0),
    (3.0,  0.5, 'B5', 0.25, 0.30, 0.0, 0.82, 0.0),
    (3.5,  0.5, 'D6', 0.25, 0.31, 0.0, 0.85, 0.0),

    # Bar 34: Stepping higher with playful bounce
    (4.0,  0.5, 'C6', 0.25, 0.30, 0.0, 0.80, 0.0),
    (4.5,  0.5, 'B5', 0.25, 0.28, 0.0, 0.80, 0.0),
    (5.0,  0.5, 'A5', 0.25, 0.28, 0.0, 0.80, 0.0),
    (5.5,  0.5, 'G5', 0.25, 0.27, 0.0, 0.80, 0.0),
    (6.0,  0.5, 'A5', 0.25, 0.29, 0.0, 0.80, 0.0),
    (6.5,  0.5, 'B5', 0.25, 0.30, 0.0, 0.80, 0.0),
    (7.0,  0.5, 'D6', 0.25, 0.31, 0.0, 0.84, 0.0),
    (7.5,  0.5, 'E6', 0.25, 0.32, 0.0, 0.84, 0.0),

    # Bar 35: Accelerating into dancing 16th-note bursts climbing upward
    (8.0,  0.5,  'D6', 0.25, 0.30, 0.02, 0.80, 0.0),
    (8.5,  0.25, 'B5', 0.25, 0.28, 0.02, 0.78, 0.0),
    (8.75, 0.25, 'D6', 0.25, 0.29, 0.02, 0.78, 0.0),
    (9.0,  0.5,  'E6', 0.25, 0.31, 0.02, 0.82, 0.0),
    (9.5,  0.25, 'D6', 0.25, 0.29, 0.02, 0.78, 0.0),
    (9.75, 0.25, 'E6', 0.25, 0.31, 0.02, 0.78, 0.0),
    (10.0, 0.5,  'F#6',0.25, 0.32, 0.02, 0.84, 0.0),
    (10.5, 0.5,  'D6', 0.25, 0.29, 0.02, 0.80, 0.0),
    (11.0, 0.5,  'E6', 0.25, 0.31, 0.02, 0.80, 0.0),
    (11.5, 0.5,  'G6', 0.25, 0.32, 0.02, 0.84, 0.0),

    # Bar 36: Final sparkling 16th-note cascade straight to peak -> launches right into Bar 37!
    (12.0, 0.25, 'E6', 0.25, 0.30, 0.03, 0.78, 0.0),
    (12.25,0.25, 'D6', 0.25, 0.28, 0.03, 0.78, 0.0),
    (12.5, 0.25, 'B5', 0.25, 0.28, 0.03, 0.78, 0.0),
    (12.75,0.25, 'D6', 0.25, 0.29, 0.03, 0.78, 0.0),
    (13.0, 0.25, 'E6', 0.25, 0.31, 0.03, 0.78, 0.0),
    (13.25,0.25, 'F#6',0.25, 0.32, 0.03, 0.78, 0.0),
    (13.5, 0.25, 'G6', 0.25, 0.33, 0.03, 0.78, 0.0),
    (13.75,0.25, 'A6', 0.25, 0.34, 0.03, 0.80, 0.0),
    # Brief radiant crest (beats 14-16) that immediately hands off to the returning accompaniment!
    (14.0, 0.5,  'B6', 0.25, 0.33, 0.03, 0.86, 0.0),
    (14.5, 0.5,  'A6', 0.25, 0.32, 0.03, 0.86, 0.0),
    (15.0, 1.0,  'F#6',0.25, 0.32, 0.03, 0.90, 4.0),
]
add_melody_events(cutout_melody, base_beat=128.0, fast_bounce=True)

# -----------------------------------------------------------------------------
# 6. SECTION C (CLIMAX RETURN): Bars 37–44 (Beats 144–176)
#    Warm sustained accompaniment sweeps right back in & phrasing broadens!
# -----------------------------------------------------------------------------
secC_prog = [
    (144, 4, 'G2', ['G3', 'B3', 'D4', 'F#4'], 0.165, 0.29),
    (148, 4, 'B2', ['B3', 'D4', 'F#4', 'A4'], 0.165, 0.29),
    (152, 4, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.165, 0.29),
    (156, 4, 'D3', ['D4', 'F#4', 'A4', 'E5'], 0.165, 0.29),
    (160, 4, 'E2', ['E3', 'G3', 'B3', 'D4'],  0.165, 0.29),
    (164, 4, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.165, 0.29),
    (168, 4, 'A2', ['A3', 'C4', 'E4', 'G4'],  0.160, 0.28),
    (172, 4, 'D2', ['D3', 'A3', 'C4', 'F#4'], 0.155, 0.27),
]
add_accompaniment(secC_prog)

secC_melody = [
    # Bar 37 (Gmaj7) — Immediate return to broad, singing, relaxed rhythm!
    (0.0,  2.0, 'G6', 0.25, 0.31, 0.05, 0.93, 6.0),
    (2.0,  1.0, 'F#6',0.25, 0.29, 0.05, 0.90, 5.0),
    (3.0,  1.0, 'D6', 0.25, 0.29, 0.05, 0.90, 5.0),
    # Bar 38 (Bm7)
    (4.0,  1.5, 'D6', 0.25, 0.29, 0.05, 0.92, 6.0),
    (5.5,  0.5, 'B5', 0.25, 0.27, 0.05, 0.88, 0.0),
    (6.0,  2.0, 'A5', 0.25, 0.28, 0.05, 0.92, 6.0),
    # Bar 39 (Cmaj7)
    (8.0,  1.5, 'G5', 0.25, 0.28, 0.05, 0.90, 0.0),
    (9.5,  0.5, 'B5', 0.25, 0.28, 0.05, 0.88, 0.0),
    (10.0, 1.0, 'E6', 0.25, 0.30, 0.05, 0.90, 5.0),
    (11.0, 1.0, 'G6', 0.25, 0.31, 0.05, 0.90, 6.0),
    # Bar 40 (Dadd9)
    (12.0, 2.5, 'F#6',0.25, 0.31, 0.05, 0.92, 6.0),
    (14.5, 0.5, 'E6', 0.25, 0.28, 0.05, 0.88, 0.0),
    (15.0, 1.0, 'D6', 0.25, 0.28, 0.05, 0.90, 0.0),
    # Bar 41 (Em7)
    (16.0, 1.5, 'G6', 0.25, 0.31, 0.05, 0.92, 6.0),
    (17.5, 0.5, 'F#6',0.25, 0.29, 0.05, 0.88, 0.0),
    (18.0, 1.0, 'E6', 0.25, 0.29, 0.05, 0.90, 5.0),
    (19.0, 1.0, 'D6', 0.25, 0.28, 0.05, 0.90, 5.0),
    # Bar 42 (Cmaj7)
    (20.0, 1.5, 'E6', 0.25, 0.30, 0.05, 0.92, 6.0),
    (21.5, 0.5, 'D6', 0.25, 0.28, 0.05, 0.88, 0.0),
    (22.0, 2.0, 'B5', 0.25, 0.28, 0.05, 0.92, 6.0),
    # Bar 43 (Am7)
    (24.0, 1.0, 'C6', 0.25, 0.29, 0.05, 0.90, 5.0),
    (25.0, 1.0, 'E6', 0.25, 0.30, 0.05, 0.90, 5.0),
    (26.0, 1.0, 'D6', 0.25, 0.29, 0.05, 0.90, 5.0),
    (27.0, 1.0, 'B5', 0.25, 0.28, 0.05, 0.90, 5.0),
    # Bar 44 (D7)
    (28.0, 2.0, 'A5', 0.25, 0.28, 0.05, 0.92, 6.0),
    (30.0, 1.0, 'F#5',0.25, 0.27, 0.05, 0.90, 5.0),
    (31.0, 1.0, 'D5', 0.25, 0.26, 0.05, 0.90, 4.0),
]
add_melody_events(secC_melody, base_beat=144.0)

climax_sparkles = [
    (0.0,  2.0, 'D6', 0.5, 0.12, -0.25),
    (8.0,  2.0, 'G6', 0.5, 0.12,  0.25),
    (16.0, 2.0, 'D6', 0.5, 0.12, -0.25),
    (24.0, 2.0, 'E6', 0.5, 0.11,  0.25),
]
add_melody_events(climax_sparkles, base_beat=144.0, use_chime=True)

# -----------------------------------------------------------------------------
# 7. SECTION A'' (WARM REPRISE): Bars 45–52 (Beats 176–208)
#    Cozy, glowing return to the mid-register theme with gentle chime answers
# -----------------------------------------------------------------------------
secA3_prog = [
    (176, 4, 'G2', ['G3', 'B3', 'D4', 'F#4'], 0.145, 0.25),
    (180, 4, 'B2', ['B3', 'D4', 'F#4', 'A4'], 0.145, 0.25),
    (184, 4, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.145, 0.25),
    (188, 4, 'D3', ['D4', 'F#4', 'A4', 'E5'], 0.145, 0.25),
    (192, 4, 'E2', ['E3', 'G3', 'B3', 'D4'],  0.140, 0.24),
    (196, 4, 'B2', ['B3', 'D4', 'F#4', 'A4'], 0.140, 0.24),
    (200, 4, 'A2', ['A3', 'C4', 'E4', 'G4'],  0.135, 0.23),
    (204, 4, 'D2', ['D3', 'A3', 'C4', 'F#4'], 0.130, 0.22),
]
add_accompaniment(secA3_prog)

secA3_melody = [
    (0.0,  1.5, 'B4', 0.25, 0.26),
    (1.5,  0.5, 'D5', 0.25, 0.24),
    (2.0,  1.0, 'G5', 0.25, 0.27),
    (3.0,  1.0, 'F#5',0.25, 0.25),

    (4.0,  1.5, 'D5', 0.25, 0.26),
    (5.5,  0.5, 'B4', 0.25, 0.23),
    (6.0,  2.0, 'A4', 0.25, 0.24),

    (8.0,  1.5, 'G4', 0.25, 0.24),
    (9.5,  0.5, 'B4', 0.25, 0.24),
    (10.0, 1.0, 'E5', 0.25, 0.27),
    (11.0, 1.0, 'D5', 0.25, 0.25),

    (12.0, 2.5, 'A4', 0.25, 0.24),
    (14.5, 0.5, 'B4', 0.25, 0.23),
    (15.0, 1.0, 'D5', 0.25, 0.25),

    (16.0, 1.5, 'G5', 0.25, 0.27),
    (17.5, 0.5, 'F#5',0.25, 0.25),
    (18.0, 1.0, 'E5', 0.25, 0.26),
    (19.0, 1.0, 'D5', 0.25, 0.25),

    (20.0, 2.0, 'F#5',0.25, 0.26),
    (22.0, 2.0, 'D5', 0.25, 0.25),

    (24.0, 1.5, 'E5', 0.25, 0.25),
    (25.5, 0.5, 'D5', 0.25, 0.24),
    (26.0, 2.0, 'C5', 0.25, 0.24),

    (28.0, 4.0, 'D5', 0.25, 0.25),
]
add_melody_events(secA3_melody, base_beat=176.0)

secA3_chimes = [
    (6.0,  2.0, 'F#5', 0.5, 0.12, -0.20),
    (14.0, 2.0, 'A5',  0.5, 0.12,  0.20),
    (22.0, 2.0, 'A5',  0.5, 0.12, -0.20),
    (30.0, 2.5, 'F#5', 0.5, 0.12,  0.20),
]
add_melody_events(secA3_chimes, base_beat=176.0, use_chime=True)

# -----------------------------------------------------------------------------
# 8. OUTRO: Bars 53–62 (Beats 208–248) — Gentle return & daydreamy fade
# -----------------------------------------------------------------------------
outro_prog = [
    (208, 8, 'G2', ['G3', 'B3', 'D4', 'F#4'], 0.125, 0.21),
    (216, 8, 'E2', ['E3', 'B3', 'D4', 'G4'],  0.115, 0.19),
    (224, 8, 'C3', ['C4', 'E4', 'G4', 'B4'],  0.105, 0.17),
    (232, 8, 'D2', ['D3', 'A3', 'C4', 'F#4'], 0.095, 0.15),
    (240, 8, 'G2', ['G3', 'B3', 'D4', 'F#4', 'A4'], 0.095, 0.16),
]
add_accompaniment(outro_prog)

outro_melody = [
    (0.0,  1.5, 'B4', 0.25, 0.23, 0.04, 0.92, 5.0),
    (1.5,  0.5, 'D5', 0.25, 0.21, 0.04, 0.90, 0.0),
    (2.0,  2.0, 'G5', 0.25, 0.23, 0.04, 0.92, 6.0),
    (4.0,  4.0, 'F#5',0.25, 0.21, 0.04, 0.94, 6.0),

    (8.0,  1.5, 'E5', 0.25, 0.20, 0.04, 0.92, 5.0),
    (9.5,  0.5, 'D5', 0.25, 0.19, 0.04, 0.90, 0.0),
    (10.0, 2.0, 'B4', 0.25, 0.19, 0.04, 0.92, 5.0),
    (12.0, 4.0, 'D5', 0.25, 0.18, 0.04, 0.94, 5.0),

    (16.0, 2.0, 'E5', 0.25, 0.17, 0.04, 0.92, 5.0),
    (18.0, 2.0, 'G5', 0.25, 0.17, 0.04, 0.92, 5.0),
    (20.0, 4.0, 'E5', 0.25, 0.16, 0.04, 0.94, 5.0),

    (24.0, 2.0, 'F#5',0.25, 0.15, 0.04, 0.92, 5.0),
    (26.0, 2.0, 'D5', 0.25, 0.14, 0.04, 0.92, 5.0),
    (28.0, 4.0, 'A4', 0.25, 0.13, 0.04, 0.94, 4.0),
]
add_melody_events(outro_melody, base_beat=208.0)

outro_chimes = [
    (32.0, 3.0, 'B5',  0.5, 0.15, -0.15),
    (34.5, 3.0, 'D6',  0.5, 0.14,  0.15),
    (37.0, 4.0, 'F#6', 0.5, 0.13,  0.00),
]
add_melody_events(outro_chimes, base_beat=208.0, use_chime=True)

# -----------------------------------------------------------------------------
# 9. CLASSIC 8-BIT STEREO ECHO ON LEAD (dotted-eighth ping-pong chiptune echo)
# -----------------------------------------------------------------------------
delay_samples = int(round(0.75 * BEAT * SR))
delay_samples2 = int(round(1.5 * BEAT * SR))
echo_L = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
echo_R = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
echo_L[delay_samples:] += 0.22 * lead_R[:-delay_samples]
echo_R[delay_samples:] += 0.22 * lead_L[:-delay_samples]
echo_L[delay_samples2:] += 0.09 * lead_L[:-delay_samples2]
echo_R[delay_samples2:] += 0.09 * lead_R[:-delay_samples2]

# -----------------------------------------------------------------------------
# 10. MIXDOWN & AUTHENTIC 8-BIT PIXEL-GAME MASTERING
# -----------------------------------------------------------------------------
mix_L = lead_L + echo_L + pad_L + harm_L + 0.707 * bass_M
mix_R = lead_R + echo_R + pad_R + harm_R + 0.707 * bass_M

b_lp, a_lp = butter(2, 9600.0 / (SR / 2.0), btype='low')
mix_L = filtfilt(b_lp, a_lp, mix_L)
mix_R = filtfilt(b_lp, a_lp, mix_R)

def retro_dac_blend(x, bits=9, blend=0.16):
    levels = 2 ** (bits - 1)
    q = np.round(x * levels) / levels
    return (1.0 - blend) * x + blend * q

mix_L = retro_dac_blend(mix_L)
mix_R = retro_dac_blend(mix_R)

fade_n = int(2.8 * SR)
fade_curve = np.linspace(1.0, 0.0, fade_n) ** 1.6
mix_L[-fade_n:] *= fade_curve
mix_R[-fade_n:] *= fade_curve

peak = max(np.max(np.abs(mix_L)), np.max(np.abs(mix_R))) + 1e-9
target_peak = 0.85
mix_L = mix_L / peak * target_peak
mix_R = mix_R / peak * target_peak

stereo = np.stack([mix_L, mix_R], axis=1)
stereo_int16 = np.clip(stereo * 32767.0, -32768, 32767).astype(np.int16)

wav_path = os.path.join(INT_DIR, "daydream_bgm_8bit.wav")
mp3_path = os.path.join(OUT_DIR, "daydream_bgm_8bit.mp3")
wavfile.write(wav_path, SR, stereo_int16)

subprocess.run([
    "ffmpeg", "-y", "-i", wav_path,
    "-codec:a", "libmp3lame", "-b:a", "192k",
    mp3_path
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

print(f"Generated v2: {mp3_path} | Duration: {TOTAL_SAMPLES/SR:.2f}s | Size: {os.path.getsize(mp3_path)} bytes")
sections = [
    ("Intro (Bars 1-8)",          0,   32),
    ("Section A (Bars 9-16)",     32,  64),
    ("Section A' (Bars 17-24)",   64,  96),
    ("Section B (Bars 25-32)",    96,  128),
    ("CUTOUT+PEAK (Bars 33-36)",  128, 144),
    ("Climax (Bars 37-44)",       144, 176),
    ("Reprise A'' (Bars 45-52)",  176, 208),
    ("Outro (Bars 53-62)",        208, 248),
]
for name, b0, b1 in sections:
    t0, t1 = b0 * BEAT, b1 * BEAT
    i0, i1 = int(t0 * SR), int(t1 * SR)
    rms_all = np.sqrt(np.mean(stereo[i0:i1] ** 2))
    rms_pad = np.sqrt(np.mean(pad_L[i0:i1] ** 2))
    print(f"  {name:26s} ({t0:5.1f}s-{t1:5.1f}s) | RMS={rms_all:.3f} | Pad={rms_pad:.4f}")