import os
import subprocess
import numpy as np
from scipy.signal import butter, filtfilt, lfilter
from scipy.io import wavfile

SR = 44100
BPM = 114.0
BEAT = 60.0 / BPM  # ~0.5263s per quarter note (3/4 waltz time: 3 beats per bar)

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

def make_adsr(n_samples, sr, attack=0.010, decay=0.14, sustain=0.46, release=0.09, exp_decay=1.0):
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

def synth_pulse(freq, dur_sec, duty=0.25, amp=0.26, attack=0.009, decay=0.14,
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
    cutoff = 5200.0 if freq < 900.0 else 4100.0
    b, a = butter(2, min(cutoff / (SR / 2.0), 0.95), btype='low')
    wave = lfilter(b, a, wave)
    pitch_comp = 1.0 if freq < 900.0 else max(0.74, (900.0 / freq) ** 0.45)
    env = make_adsr(n, SR, attack=attack, decay=decay, sustain=sustain,
                    release=release, exp_decay=exp_decay)
    return wave * env * amp * pitch_comp

def synth_nes_triangle(freq, dur_sec, amp=0.26, attack=0.025, decay=0.08,
                       sustain=0.86, release=0.12, exp_decay=0.22):
    n = int(round(dur_sec * SR))
    if n <= 0 or freq <= 0:
        return np.zeros(max(0, n), dtype=np.float64)
    t = np.arange(n) / SR
    phase = (freq * t) % 1.0
    tri = 2.0 * np.abs(2.0 * phase - 1.0) - 1.0
    tri_q = np.round(tri * 7.5) / 7.5
    env = make_adsr(n, SR, attack=attack, decay=decay, sustain=sustain,
                    release=release, exp_decay=exp_decay)
    return tri_q * env * amp

def synth_pad_chord(notes, dur_sec, amp=0.12, duty=0.50, attack=0.24, release=0.38):
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
    b, a = butter(2, 1800.0 / (SR / 2.0), btype='low')
    buf = filtfilt(b, a, buf)
    env = make_adsr(n, SR, attack=attack, decay=0.18, sustain=0.80,
                    release=release, exp_decay=0.16)
    return buf * env * amp

def synth_chime(freq, dur_sec, amp=0.15):
    n = int(round(dur_sec * SR))
    if n <= 0 or freq <= 0:
        return np.zeros(max(0, n), dtype=np.float64)
    t = np.arange(n) / SR
    phase = (freq * t) % 1.0
    sq = np.where(phase < 0.5, 1.0, -1.0)
    tri = 2.0 * np.abs(2.0 * phase - 1.0) - 1.0
    wave = 0.42 * sq + 0.58 * tri
    b, a = butter(2, 4200.0 / (SR / 2.0), btype='low')
    wave = lfilter(b, a, wave)
    env = np.exp(-t * 3.1) * make_adsr(n, SR, attack=0.005, decay=0.04, sustain=0.95,
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
# TRACK 2 — "Cloud Waltz (8-Bit)" v2 (Smooth 0:13 Entrance + Clean ~2:12 Ending)
# Key: F Major | 3/4 Time | 114 BPM | 84 Bars (252 Beats) = ~135.4s (2:15)
# =============================================================================
TOTAL_BEATS = 252
TAIL_SEC = 2.8
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

def add_waltz_accompaniment(prog, gentle_lilt=True):
    for sb, db, b_root, b_fifth, c_notes, p_amp, b_amp in prog:
        dur_s = db * BEAT
        if c_notes:
            p_sig = synth_pad_chord(c_notes, dur_s + 0.16, amp=p_amp, duty=0.50, attack=0.22, release=0.38)
            place_stereo(pad_L, pad_R, p_sig, sb, pan=-0.12)
            if len(c_notes) >= 3:
                p_hi = synth_pad_chord(c_notes[-2:], dur_s + 0.16, amp=p_amp * 0.38, duty=0.25, attack=0.28, release=0.38)
                place_stereo(pad_L, pad_R, p_hi, sb, pan=0.18)
        if b_root and b_amp > 0:
            if gentle_lilt and db >= 3 and b_fifth:
                n_bars = int(round(db / 3.0))
                for bar in range(n_bars):
                    bs = sb + bar * 3.0
                    s1 = synth_nes_triangle(note_to_freq(b_root), 2.05 * BEAT, amp=b_amp,
                                            attack=0.025, release=0.12, exp_decay=0.25)
                    add_to_track(bass_M, s1, bs)
                    s2 = synth_nes_triangle(note_to_freq(b_fifth), 0.98 * BEAT, amp=b_amp * 0.65,
                                            attack=0.02, release=0.10, exp_decay=0.35)
                    add_to_track(bass_M, s2, bs + 2.0)
            else:
                s = synth_nes_triangle(note_to_freq(b_root), dur_s + 0.05, amp=b_amp,
                                       attack=0.035, release=0.16, exp_decay=0.18)
                add_to_track(bass_M, s, sb)

def add_melody_events(events, base_beat=0.0, use_chime=False, playful=False, soft_attack=False):
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
            sig = synth_chime(f, max(dur_s, 0.48), amp=amp)
        else:
            att = 0.035 if soft_attack else (0.006 if db <= 0.5 else 0.009)
            rel = 0.04 if db <= 0.5 else 0.08
            sus = 0.40 if playful else 0.48
            dec = 0.10 if playful else 0.15
            exp_d = 1.35 if playful else 0.90
            sig = synth_pulse(f, dur_s, duty=duty, amp=amp, attack=att, decay=dec,
                              sustain=sus, release=rel, exp_decay=exp_d, vibrato_cents=vib)
        place_stereo(lead_L, lead_R, sig, base_beat + bo, pan=pan)

# -----------------------------------------------------------------------------
# 1. INTRO: Bars 1–8 (Beats 0–24) — Floating 3/4 daydream chords + chime arpeggio
# -----------------------------------------------------------------------------
intro_prog = [
    (0,  6, 'F2', 'C3', ['F3', 'A3', 'C4', 'E4'],  0.125, 0.20),
    (6,  6, 'D2', 'A2', ['D3', 'A3', 'C4', 'F4'],  0.125, 0.20),
    (12, 6, 'Bb2','F3', ['Bb3','D4', 'F4', 'A4'],  0.130, 0.21),
    (18, 6, 'C2', 'G2', ['C3', 'G3', 'Bb3','E4'],  0.135, 0.21),
]
add_waltz_accompaniment(intro_prog, gentle_lilt=False)

intro_chimes = [
    (0.0, 1.5, 'C5', 0.5, 0.14, -0.18),
    (1.0, 1.5, 'F5', 0.5, 0.15,  0.00),
    (2.0, 2.0, 'A5', 0.5, 0.16,  0.18),
    (4.0, 2.0, 'G5', 0.5, 0.14, -0.10),

    (6.0, 1.5, 'A4', 0.5, 0.14, -0.18),
    (7.0, 1.5, 'D5', 0.5, 0.15,  0.00),
    (8.0, 2.0, 'F5', 0.5, 0.16,  0.18),
    (10.0,2.0, 'E5', 0.5, 0.14, -0.10),

    (12.0,1.5, 'D5', 0.5, 0.15, -0.18),
    (13.0,1.5, 'F5', 0.5, 0.16,  0.00),
    (14.0,2.0, 'A5', 0.5, 0.17,  0.18),
    (16.0,2.0, 'G5', 0.5, 0.15, -0.10),

    (18.0,1.5, 'E5', 0.5, 0.15, -0.18),
    (19.0,1.5, 'G5', 0.5, 0.16,  0.00),
    (20.0,2.5, 'C6', 0.5, 0.16,  0.18),
    # Gentle bridging chime descending smoothly into Section A!
    (22.0,2.5, 'G5', 0.5, 0.13,  0.05),
]
add_melody_events(intro_chimes, base_beat=0.0, use_chime=True)

# -----------------------------------------------------------------------------
# 2. SECTION A: Bars 9–24 (Beats 24–72) — Smooth, gentle entrance at 0:13!
# -----------------------------------------------------------------------------
secA_prog = [
    # Gradual warmth on Bars 9–10 so the transition at 0:13 feels effortless
    (24, 6, 'F2', 'C3', ['F3', 'A3', 'C4', 'E4'],  0.135, 0.21),
    (30, 6, 'A2', 'E3', ['A3', 'C4', 'E4', 'G4'],  0.140, 0.23),
    (36, 6, 'Bb2','F3', ['Bb3','D4', 'F4', 'A4'],  0.140, 0.24),
    (42, 6, 'C2', 'G2', ['C3', 'G3', 'Bb3','D4'],  0.140, 0.24),
    (48, 6, 'D2', 'A2', ['D3', 'F3', 'A3', 'C4'],  0.140, 0.24),
    (54, 6, 'A2', 'E3', ['A3', 'C4', 'E4', 'G4'],  0.140, 0.24),
    (60, 6, 'G2', 'D3', ['G3', 'Bb3','D4', 'F4'],  0.140, 0.24),
    (66, 6, 'C2', 'G2', ['C3', 'E3', 'G3', 'Bb3'], 0.140, 0.24),
]
add_waltz_accompaniment(secA_prog, gentle_lilt=True)

# First 2 bars of Section A enter softly with gentle attack & natural swell!
secA_entrance = [
    (0.0,  2.0, 'A4', 0.25, 0.175, 0.04, 0.94, 4.0),
    (2.0,  1.0, 'C5', 0.25, 0.205, 0.04, 0.92, 4.0),
    (3.0,  1.5, 'F5', 0.25, 0.240, 0.04, 0.92, 5.0),
    (4.5,  0.5, 'G5', 0.25, 0.245, 0.04, 0.90, 0.0),
    (5.0,  1.0, 'E5', 0.25, 0.255, 0.04, 0.90, 5.0),
]
add_melody_events(secA_entrance, base_beat=24.0, soft_attack=True)

secA_melody_rest = [
    # Bars 11–12 (Am7)
    (6.0,  2.0, 'C5', 0.25, 0.26),
    (8.0,  1.0, 'A4', 0.25, 0.24),
    (9.0,  3.0, 'G4', 0.25, 0.24),
    # Bars 13–14 (Bbmaj7)
    (12.0, 2.0, 'D5', 0.25, 0.27),
    (14.0, 1.0, 'F5', 0.25, 0.27),
    (15.0, 1.5, 'A5', 0.25, 0.29),
    (16.5, 0.5, 'G5', 0.25, 0.27),
    (17.0, 1.0, 'F5', 0.25, 0.27),
    # Bars 15–16 (C9)
    (18.0, 2.0, 'G5', 0.25, 0.28),
    (20.0, 1.0, 'E5', 0.25, 0.26),
    (21.0, 2.0, 'D5', 0.25, 0.25),
    (23.0, 1.0, 'C5', 0.25, 0.25),

    # Bars 17–18 (Dm7)
    (24.0, 2.0, 'F5', 0.25, 0.28),
    (26.0, 1.0, 'E5', 0.25, 0.27),
    (27.0, 1.5, 'D5', 0.25, 0.27),
    (28.5, 0.5, 'C5', 0.25, 0.25),
    (29.0, 1.0, 'A4', 0.25, 0.26),
    # Bars 19–20 (Am7)
    (30.0, 2.0, 'E5', 0.25, 0.28),
    (32.0, 1.0, 'D5', 0.25, 0.27),
    (33.0, 3.0, 'C5', 0.25, 0.27),
    # Bars 21–22 (Gm7)
    (36.0, 1.0, 'Bb4',0.25, 0.26),
    (37.0, 1.0, 'D5', 0.25, 0.27),
    (38.0, 1.0, 'F5', 0.25, 0.28),
    (39.0, 2.0, 'G5', 0.25, 0.29),
    (41.0, 1.0, 'F5', 0.25, 0.27),
    # Bars 23–24 (C7)
    (42.0, 2.0, 'E5', 0.25, 0.28),
    (44.0, 1.0, 'G5', 0.25, 0.28),
    (45.0, 2.0, 'C5', 0.25, 0.26),
    (47.0, 1.0, 'D5', 0.25, 0.26),
]
add_melody_events(secA_melody_rest, base_beat=24.0)

# -----------------------------------------------------------------------------
# 3. SECTION B: Bars 25–40 (Beats 72–120) — Warm Sunlit Journey + Soft Harmony
# -----------------------------------------------------------------------------
secB_prog = [
    (72,  6, 'Bb2','F3', ['Bb3','D4', 'F4', 'A4'],  0.15, 0.25),
    (78,  6, 'C3', 'G3', ['C4', 'E4', 'G4', 'Bb4'], 0.15, 0.25),
    (84,  6, 'A2', 'E3', ['A3', 'C4', 'E4', 'G4'],  0.15, 0.25),
    (90,  6, 'D2', 'A2', ['D3', 'F3', 'A3', 'C4'],  0.15, 0.25),
    (96,  6, 'G2', 'D3', ['G3', 'Bb3','D4', 'F4'],  0.15, 0.25),
    (102, 6, 'C2', 'G2', ['C3', 'E3', 'G3', 'D4'],  0.15, 0.25),
    (108, 6, 'F2', 'C3', ['F3', 'A3', 'C4', 'E4'],  0.15, 0.25),
    (114, 6, 'C2', 'G2', ['C3', 'G3', 'Bb3','E4'],  0.14, 0.23),
]
add_waltz_accompaniment(secB_prog, gentle_lilt=True)

secB_melody = [
    (0.0,  2.0, 'F5', 0.25, 0.28),
    (2.0,  1.0, 'G5', 0.25, 0.28),
    (3.0,  2.0, 'A5', 0.25, 0.30),
    (5.0,  1.0, 'F5', 0.25, 0.27),

    (6.0,  1.5, 'G5', 0.25, 0.29),
    (7.5,  0.5, 'A5', 0.25, 0.28),
    (8.0,  1.0, 'G5', 0.25, 0.28),
    (9.0,  2.0, 'E5', 0.25, 0.27),
    (11.0, 1.0, 'C5', 0.25, 0.26),

    (12.0, 2.0, 'E5', 0.25, 0.28),
    (14.0, 1.0, 'G5', 0.25, 0.29),
    (15.0, 2.0, 'C6', 0.25, 0.30),
    (17.0, 1.0, 'G5', 0.25, 0.28),

    (18.0, 2.0, 'A5', 0.25, 0.30),
    (20.0, 1.0, 'G5', 0.25, 0.28),
    (21.0, 3.0, 'F5', 0.25, 0.28),

    (24.0, 1.5, 'D5', 0.25, 0.27),
    (25.5, 0.5, 'E5', 0.25, 0.27),
    (26.0, 1.0, 'F5', 0.25, 0.28),
    (27.0, 2.0, 'G5', 0.25, 0.29),
    (29.0, 1.0, 'A5', 0.25, 0.29),

    (30.0, 2.0, 'G5', 0.25, 0.29),
    (32.0, 1.0, 'E5', 0.25, 0.27),
    (33.0, 3.0, 'D5', 0.25, 0.27),

    (36.0, 2.0, 'C5', 0.25, 0.27),
    (38.0, 1.0, 'F5', 0.25, 0.28),
    (39.0, 3.0, 'A5', 0.25, 0.30),

    (42.0, 2.0, 'G5', 0.25, 0.28),
    (44.0, 1.0, 'F5', 0.25, 0.27),
    (45.0, 3.0, 'E5', 0.25, 0.26),
]
add_melody_events(secB_melody, base_beat=72.0)

secB_harm = [
    (0.0,  6.0, 'D4'),
    (6.0,  6.0, 'E4'),
    (12.0, 6.0, 'C4'),
    (18.0, 6.0, 'A4'),
    (24.0, 6.0, 'Bb4'),
    (30.0, 6.0, 'G4'),
    (36.0, 6.0, 'A4'),
    (42.0, 6.0, 'G4'),
]
for bo, db, note in secB_harm:
    sig = synth_nes_triangle(note_to_freq(note), db * BEAT * 0.94, amp=0.09,
                             attack=0.09, decay=0.12, sustain=0.72, release=0.18)
    place_stereo(harm_L, harm_R, sig, 72.0 + bo, pan=-0.22)

# -----------------------------------------------------------------------------
# 4. SECTION C: Bars 41–52 (Beats 120–156) — Airy Music-Box Duet Interlude
# -----------------------------------------------------------------------------
secC_prog = [
    (120, 6, None, None, ['F4', 'A4', 'C5'],       0.085, 0.0),
    (126, 6, None, None, ['E4', 'G4', 'C5'],       0.085, 0.0),
    (132, 6, None, None, ['D4', 'F4', 'A4'],       0.090, 0.0),
    (138, 6, None, None, ['C4', 'F4', 'A4'],       0.090, 0.0),
    (144, 6, None, None, ['Bb3','D4', 'F4', 'A4'], 0.105, 0.0),
    (150, 6, 'C3', None, ['C4', 'E4', 'G4', 'Bb4'],0.125, 0.18),
]
add_waltz_accompaniment(secC_prog, gentle_lilt=False)

secC_lead = [
    (0.0,  0.5, 'C5', 0.25, 0.24, -0.14, 0.82, 0.0),
    (0.5,  0.5, 'F5', 0.25, 0.25, -0.14, 0.82, 0.0),
    (1.0,  1.0, 'A5', 0.25, 0.27, -0.14, 0.86, 0.0),
    (2.0,  1.0, 'G5', 0.25, 0.25, -0.14, 0.86, 0.0),
    (3.0,  1.5, 'F5', 0.25, 0.26, -0.14, 0.88, 0.0),

    (6.0,  0.5, 'E5', 0.25, 0.25, -0.14, 0.82, 0.0),
    (6.5,  0.5, 'G5', 0.25, 0.26, -0.14, 0.82, 0.0),
    (7.0,  1.0, 'C6', 0.25, 0.28, -0.14, 0.86, 0.0),
    (8.0,  1.0, 'A5', 0.25, 0.26, -0.14, 0.86, 0.0),
    (9.0,  1.5, 'G5', 0.25, 0.26, -0.14, 0.88, 0.0),

    (12.0, 0.5, 'D5', 0.25, 0.25, -0.12, 0.82, 0.0),
    (12.5, 0.5, 'F5', 0.25, 0.26, -0.12, 0.82, 0.0),
    (13.0, 1.0, 'A5', 0.25, 0.28, -0.12, 0.86, 0.0),
    (14.0, 1.0, 'G5', 0.25, 0.26, -0.12, 0.86, 0.0),
    (15.0, 1.5, 'F5', 0.25, 0.27, -0.12, 0.88, 0.0),

    (18.0, 0.5, 'C5', 0.25, 0.25, -0.10, 0.82, 0.0),
    (18.5, 0.5, 'F5', 0.25, 0.26, -0.10, 0.82, 0.0),
    (19.0, 1.0, 'G5', 0.25, 0.27, -0.10, 0.86, 0.0),
    (20.0, 1.0, 'A5', 0.25, 0.28, -0.10, 0.86, 0.0),
    (21.0, 2.0, 'C6', 0.25, 0.29, -0.10, 0.90, 5.0),

    (24.0, 1.0, 'D6', 0.25, 0.30,  0.00, 0.88, 0.0),
    (25.0, 0.5, 'C6', 0.25, 0.28,  0.00, 0.82, 0.0),
    (25.5, 0.5, 'A5', 0.25, 0.28,  0.00, 0.82, 0.0),
    (26.0, 1.0, 'G5', 0.25, 0.28,  0.00, 0.88, 0.0),
    (27.0, 1.5, 'A5', 0.25, 0.29,  0.00, 0.90, 0.0),
    (28.5, 0.5, 'Bb5',0.25, 0.29,  0.00, 0.85, 0.0),
    (29.0, 1.0, 'C6', 0.25, 0.30,  0.00, 0.90, 0.0),

    (30.0, 1.0, 'G5', 0.25, 0.29,  0.02, 0.88, 0.0),
    (31.0, 1.0, 'A5', 0.25, 0.30,  0.02, 0.88, 0.0),
    (32.0, 1.0, 'C6', 0.25, 0.31,  0.02, 0.88, 0.0),
    (33.0, 1.0, 'D6', 0.25, 0.31,  0.02, 0.88, 0.0),
    (34.0, 1.0, 'E6', 0.25, 0.32,  0.02, 0.90, 0.0),
    (35.0, 1.0, 'G6', 0.25, 0.32,  0.02, 0.90, 0.0),
]
add_melody_events(secC_lead, base_beat=120.0, playful=True)

secC_chimes = [
    (4.0,  1.0, 'C6', 0.5, 0.16, 0.22),
    (5.0,  1.0, 'A5', 0.5, 0.15, 0.22),
    (10.0, 1.0, 'E6', 0.5, 0.16, 0.22),
    (11.0, 1.0, 'C6', 0.5, 0.15, 0.22),
    (16.0, 1.0, 'D6', 0.5, 0.16, 0.22),
    (17.0, 1.0, 'A5', 0.5, 0.15, 0.22),
    (22.0, 1.5, 'F6', 0.5, 0.17, 0.22),
    (27.0, 2.0, 'F6', 0.5, 0.15, 0.22),
    (33.0, 2.0, 'G6', 0.5, 0.15, 0.22),
]
add_melody_events(secC_chimes, base_beat=120.0, use_chime=True)

# -----------------------------------------------------------------------------
# 5. SECTION D (GOLDEN SKY CLIMAX): Bars 53–68 (Beats 156–204)
# -----------------------------------------------------------------------------
secD_prog = [
    (156, 6, 'F2', 'C3', ['F3', 'A3', 'C4', 'E4'],  0.165, 0.28),
    (162, 6, 'A2', 'E3', ['A3', 'C4', 'E4', 'G4'],  0.165, 0.28),
    (168, 6, 'Bb2','F3', ['Bb3','D4', 'F4', 'A4'],  0.165, 0.28),
    (174, 6, 'C2', 'G2', ['C3', 'G3', 'Bb3','D4'],  0.165, 0.28),
    (180, 6, 'D2', 'A2', ['D3', 'F3', 'A3', 'C4'],  0.165, 0.28),
    (186, 6, 'Bb2','F3', ['Bb3','D4', 'F4', 'A4'],  0.165, 0.28),
    (192, 6, 'G2', 'D3', ['G3', 'Bb3','D4', 'F4'],  0.160, 0.27),
    (198, 6, 'C2', 'G2', ['C3', 'E3', 'G3', 'Bb3'], 0.155, 0.26),
]
add_waltz_accompaniment(secD_prog, gentle_lilt=True)

secD_melody = [
    (0.0,  2.0, 'F6', 0.25, 0.31, 0.05, 0.92, 6.0),
    (2.0,  1.0, 'E6', 0.25, 0.29, 0.05, 0.90, 0.0),
    (3.0,  1.5, 'C6', 0.25, 0.30, 0.05, 0.92, 5.0),
    (4.5,  0.5, 'D6', 0.25, 0.28, 0.05, 0.88, 0.0),
    (5.0,  1.0, 'E6', 0.25, 0.29, 0.05, 0.90, 0.0),

    (6.0,  2.0, 'C6', 0.25, 0.30, 0.05, 0.92, 6.0),
    (8.0,  1.0, 'A5', 0.25, 0.28, 0.05, 0.90, 0.0),
    (9.0,  3.0, 'G5', 0.25, 0.29, 0.05, 0.93, 6.0),

    (12.0, 2.0, 'D6', 0.25, 0.30, 0.05, 0.92, 5.0),
    (14.0, 1.0, 'F6', 0.25, 0.31, 0.05, 0.90, 0.0),
    (15.0, 1.5, 'A6', 0.25, 0.31, 0.05, 0.92, 6.0),
    (16.5, 0.5, 'G6', 0.25, 0.29, 0.05, 0.88, 0.0),
    (17.0, 1.0, 'F6', 0.25, 0.30, 0.05, 0.90, 0.0),

    (18.0, 2.0, 'G6', 0.25, 0.31, 0.05, 0.92, 6.0),
    (20.0, 1.0, 'E6', 0.25, 0.29, 0.05, 0.90, 0.0),
    (21.0, 2.0, 'D6', 0.25, 0.29, 0.05, 0.92, 5.0),
    (23.0, 1.0, 'C6', 0.25, 0.28, 0.05, 0.90, 0.0),

    (24.0, 2.0, 'F6', 0.25, 0.31, 0.05, 0.92, 6.0),
    (26.0, 1.0, 'E6', 0.25, 0.29, 0.05, 0.90, 0.0),
    (27.0, 1.5, 'D6', 0.25, 0.29, 0.05, 0.92, 5.0),
    (28.5, 0.5, 'C6', 0.25, 0.28, 0.05, 0.88, 0.0),
    (29.0, 1.0, 'A5', 0.25, 0.28, 0.05, 0.90, 0.0),

    (30.0, 2.0, 'D6', 0.25, 0.30, 0.05, 0.92, 6.0),
    (32.0, 1.0, 'C6', 0.25, 0.28, 0.05, 0.90, 0.0),
    (33.0, 3.0, 'A5', 0.25, 0.29, 0.05, 0.93, 6.0),

    (36.0, 1.0, 'Bb5',0.25, 0.28, 0.05, 0.90, 0.0),
    (37.0, 1.0, 'D6', 0.25, 0.29, 0.05, 0.90, 0.0),
    (38.0, 1.0, 'F6', 0.25, 0.30, 0.05, 0.90, 5.0),
    (39.0, 2.0, 'G6', 0.25, 0.31, 0.05, 0.92, 6.0),
    (41.0, 1.0, 'F6', 0.25, 0.29, 0.05, 0.90, 0.0),

    (42.0, 2.0, 'E6', 0.25, 0.29, 0.05, 0.92, 6.0),
    (44.0, 1.0, 'C6', 0.25, 0.28, 0.05, 0.90, 0.0),
    (45.0, 2.0, 'G5', 0.25, 0.27, 0.05, 0.92, 5.0),
    (47.0, 1.0, 'E5', 0.25, 0.26, 0.05, 0.90, 0.0),
]
add_melody_events(secD_melody, base_beat=156.0)

secD_sparkles = [
    (0.0,  2.5, 'C6', 0.5, 0.12, -0.24),
    (12.0, 2.5, 'F6', 0.5, 0.12,  0.24),
    (24.0, 2.5, 'C6', 0.5, 0.12, -0.24),
    (36.0, 2.5, 'D6', 0.5, 0.11,  0.24),
]
add_melody_events(secD_sparkles, base_beat=156.0, use_chime=True)

# -----------------------------------------------------------------------------
# 6. SECTION A' (COZY REPRISE): Bars 69–80 (Beats 204–240, 1:47–2:06)
#    Naturally winds down directly into the clean final Fmaj9 cadence!
# -----------------------------------------------------------------------------
secA2_prog = [
    (204, 6, 'F2', 'C3', ['F3', 'A3', 'C4', 'E4'],  0.140, 0.23),
    (210, 6, 'A2', 'E3', ['A3', 'C4', 'E4', 'G4'],  0.135, 0.22),
    (216, 6, 'Bb2','F3', ['Bb3','D4', 'F4', 'A4'],  0.130, 0.21),
    (222, 6, 'C2', 'G2', ['C3', 'G3', 'Bb3','D4'],  0.125, 0.20),
    (228, 6, 'G2', 'D3', ['G3', 'Bb3','D4', 'F4'],  0.120, 0.19),
    (234, 6, 'C2', 'G2', ['C3', 'E3', 'G3', 'Bb3'], 0.115, 0.18),
]
add_waltz_accompaniment(secA2_prog, gentle_lilt=True)

secA2_melody = [
    (0.0,  2.0, 'A4', 0.25, 0.25),
    (2.0,  1.0, 'C5', 0.25, 0.24),
    (3.0,  1.5, 'F5', 0.25, 0.27),
    (4.5,  0.5, 'G5', 0.25, 0.25),
    (5.0,  1.0, 'E5', 0.25, 0.25),

    (6.0,  2.0, 'C5', 0.25, 0.25),
    (8.0,  1.0, 'A4', 0.25, 0.23),
    (9.0,  3.0, 'G4', 0.25, 0.23),

    (12.0, 2.0, 'D5', 0.25, 0.25),
    (14.0, 1.0, 'F5', 0.25, 0.25),
    (15.0, 2.0, 'A5', 0.25, 0.26),
    (17.0, 1.0, 'F5', 0.25, 0.24),

    (18.0, 2.0, 'G5', 0.25, 0.25),
    (20.0, 1.0, 'E5', 0.25, 0.24),
    (21.0, 3.0, 'D5', 0.25, 0.23),

    (24.0, 2.0, 'D5', 0.25, 0.23),
    (26.0, 1.0, 'F5', 0.25, 0.23),
    (27.0, 3.0, 'G5', 0.25, 0.23),

    (30.0, 2.0, 'E5', 0.25, 0.22),
    (32.0, 1.0, 'D5', 0.25, 0.21),
    (33.0, 3.0, 'E5', 0.25, 0.20),
]
add_melody_events(secA2_melody, base_beat=204.0)

# -----------------------------------------------------------------------------
# 7. CLEAN FINAL CADENCE: Bars 81–84 (Beats 240–252, 2:06–2:12 + gentle fade)
#    No extra tacked-on melody — just resolves home to warm Fmaj9 + 4 floating chimes!
# -----------------------------------------------------------------------------
outro_prog = [
    (240, 12, 'F2', None, ['F3', 'A3', 'C4', 'E4', 'G4'], 0.110, 0.17),
]
add_waltz_accompaniment(outro_prog, gentle_lilt=False)

# One warm resolving home note F5 + delicate trailing chimes
add_melody_events([(0.0, 6.0, 'F5', 0.25, 0.20, 0.04, 0.95, 5.0)], base_beat=240.0, soft_attack=True)

# 合成大肥鱼改动（2026-11-22 用户要求）：去掉结尾这四声八音盒散音，只留 F5 长音收尾。原来是：
# outro_chimes = [
#     (3.0, 2.5, 'C5', 0.5, 0.14, -0.18),
#     (4.5, 2.5, 'F5', 0.5, 0.14,  0.00),
#     (6.0, 3.5, 'A5', 0.5, 0.14,  0.18),
#     (7.5, 4.0, 'E6', 0.5, 0.12,  0.00),
# ]
# add_melody_events(outro_chimes, base_beat=240.0, use_chime=True)

# -----------------------------------------------------------------------------
# 8. CLASSIC 8-BIT STEREO ECHO ON LEAD (subtle 1-beat / 2-beat waltz echo)
# -----------------------------------------------------------------------------
delay_samples = int(round(1.0 * BEAT * SR))
delay_samples2 = int(round(2.0 * BEAT * SR))
echo_L = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
echo_R = np.zeros(TOTAL_SAMPLES, dtype=np.float64)
echo_L[delay_samples:] += 0.20 * lead_R[:-delay_samples]
echo_R[delay_samples:] += 0.20 * lead_L[:-delay_samples]
echo_L[delay_samples2:] += 0.08 * lead_L[:-delay_samples2]
echo_R[delay_samples2:] += 0.08 * lead_R[:-delay_samples2]

# -----------------------------------------------------------------------------
# 9. MIXDOWN & AUTHENTIC 8-BIT PIXEL-GAME MASTERING
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

fade_n = int(3.0 * SR)
fade_curve = np.linspace(1.0, 0.0, fade_n) ** 1.6
mix_L[-fade_n:] *= fade_curve
mix_R[-fade_n:] *= fade_curve

peak = max(np.max(np.abs(mix_L)), np.max(np.abs(mix_R))) + 1e-9
target_peak = 0.85
mix_L = mix_L / peak * target_peak
mix_R = mix_R / peak * target_peak

stereo = np.stack([mix_L, mix_R], axis=1)
stereo_int16 = np.clip(stereo * 32767.0, -32768, 32767).astype(np.int16)

wav_path = os.path.join(INT_DIR, "cloud_waltz_bgm_8bit.wav")
mp3_path = os.path.join(OUT_DIR, "cloud_waltz_bgm_8bit.mp3")
wavfile.write(wav_path, SR, stereo_int16)

subprocess.run([
    "ffmpeg", "-y", "-i", wav_path,
    "-codec:a", "libmp3lame", "-b:a", "192k",
    mp3_path
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

print(f"Generated Track 2 v2: {mp3_path} | Duration: {TOTAL_SAMPLES/SR:.2f}s | Size: {os.path.getsize(mp3_path)} bytes")