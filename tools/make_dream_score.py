"""把 tools/dream_bgm/ 里 Gemini 的两个合成脚本「拆」成乐谱，写进 bgm.js 的 DREAM_SCORES（美梦模式用自带组件现场合成时用）。

    python tools/make_dream_score.py

做法：原样执行脚本，但拦下每一次合成调用（synth_pulse / synth_nes_triangle / synth_pad_chord / synth_chime）
和它内部的 make_adsr、butter，记下实际生效的参数（含默认值）；再拦 add_to_track，记下每个音放在第几拍、
左右声道各乘多少（由 place_stereo 的声像算出来）、进的是哪条轨（lead 轨有回声，其余没有）。
回声、母带低通、淡出这些混音参数从脚本源码里读；最后把混音跑到峰值归一化那一步，拿到归一化系数。
脚本的乐器写法（波形配比、去混叠、量化级数等）如果变了，这里的断言会报错，要同步改 bgm.js 的播放器。
需要 numpy、scipy（不需要 ffmpeg）。
"""
import inspect
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'tools' / 'dream_bgm'
JOBS = [('ds1', 'compose_daydream_8bit.py'), ('ds2', 'compose_cloud_waltz_8bit.py')]


class Tagged(np.ndarray):
    """合成函数的返回值：带上事件编号，乘声像系数、切片之后也带着"""
    def __array_finalize__(self, obj):
        self.ev = getattr(obj, 'ev', None)


def r(x, n=6):
    return float(f'{x:.{n}g}')


def need(src, pattern, what):
    m = re.search(pattern, src, re.S)
    if not m:
        sys.exit(f'脚本里没找到 {what}（{pattern}）：乐器写法变了，要同步改 bgm.js 的乐谱播放器')
    return m


def extract(path):
    src = path.read_text(encoding='utf-8')
    # 乐器写法的断言（bgm.js 的播放器按这些写死）
    need(src, r"wave = np\.where\(phase < duty, 1\.0, -1\.0\) - \(2\.0 \* duty - 1\.0\)", '脉冲波写法')
    need(src, r"tri_q = np\.round\(tri \* 7\.5\) / 7\.5", '量化三角波')
    need(src, r"voice = 0\.22 \* sq \+ 0\.78 \* tri", '铺底音色配比')
    need(src, r"detune = 1\.0 \+ \(idx - \(len\(notes\) - 1\) / 2\.0\) \* 0\.0007", '铺底失谐')
    need(src, r"buf \+= voice / max\(1, len\(notes\) \*\* 0\.65\)", '铺底音量')
    need(src, r"buf = filtfilt\(b, a, buf\)", '铺底零相位滤波')
    need(src, r"pitch_comp = 1\.0 if freq < 900\.0 else max\(0\.74, \(900\.0 / freq\) \*\* 0\.45\)", '高音补偿')
    chime = need(src, r"def synth_chime.*?wave = ([\d.]+) \* sq \+ ([\d.]+) \* tri.*?np\.exp\(-t \* ([\d.]+)\)", '铃音配比 / 衰减')
    echo = need(src, r"delay_samples = int\(round\(([\d.]+) \* BEAT \* SR\)\)\s*delay_samples2 = int\(round\(([\d.]+) \* BEAT \* SR\)\).*?"
                     r"echo_L\[delay_samples:\] \+= ([\d.]+) \* lead_R.*?echo_L\[delay_samples2:\] \+= ([\d.]+) \* lead_L", '回声')
    need(src, r"mix_L = lead_L \+ echo_L \+ pad_L \+ harm_L \+ 0\.707 \* bass_M", '混音')
    lpf = need(src, r"b_lp, a_lp = butter\(2, ([\d.]+) / \(SR / 2\.0\), btype='low'\)\s*mix_L = filtfilt", '母带低通')
    fade = need(src, r"fade_n = int\(([\d.]+) \* SR\)\s*fade_curve = np\.linspace\(1\.0, 0\.0, fade_n\) \*\* ([\d.]+)", '淡出')
    target = need(src, r"target_peak = ([\d.]+)", '峰值')

    head, rest = src.split('\nTOTAL_BEATS =', 1)
    rest = 'TOTAL_BEATS =' + rest
    echo_at = rest.index('CLASSIC 8-BIT STEREO ECHO')
    echo_at = rest.rfind('\n# ---', 0, echo_at)
    body, mixdown = rest[:echo_at], rest[echo_at:]
    mixdown = mixdown[:mixdown.index('\n', mixdown.index('peak = max(')) + 1]   # 只跑到算出峰值

    ns = {'__name__': '__dream_score__'}
    exec(compile(head, str(path), 'exec'), ns)
    SR, BEAT = ns['SR'], ns['BEAT']

    calls = {'adsr': [], 'butter': [], 'filt': []}
    o_adsr, o_butter, o_filtfilt, o_lfilter = ns['make_adsr'], ns['butter'], ns['filtfilt'], ns['lfilter']

    def make_adsr(*a, **k):
        b = inspect.signature(o_adsr).bind(*a, **k); b.apply_defaults()
        calls['adsr'].append({x: b.arguments[x] for x in ('attack', 'decay', 'sustain', 'release', 'exp_decay')})
        return o_adsr(*a, **k)

    def butter(*a, **k):
        calls['butter'].append(a[1] * SR / 2.0)
        return o_butter(*a, **k)

    def filtfilt(*a, **k):
        calls['filt'].append('ff'); return o_filtfilt(*a, **k)

    def lfilter(*a, **k):
        calls['filt'].append('lf'); return o_lfilter(*a, **k)

    ns.update(make_adsr=make_adsr, butter=butter, filtfilt=filtfilt, lfilter=lfilter)

    events, origs = [], []

    def wrap(kind, fn):
        sig = inspect.signature(fn)

        def w(*a, **k):
            b = sig.bind(*a, **k); b.apply_defaults()
            for v in calls.values(): v.clear()
            out = fn(*a, **k)
            if len(out) == 0:
                return out
            ev = {'kind': kind, 'args': dict(b.arguments), 'adsr': list(calls['adsr']), 'cut': list(calls['butter']),
                  'filt': list(calls['filt']), 'place': []}
            events.append(ev); origs.append(out)
            t = out.view(Tagged); t.ev = len(events) - 1
            return t
        return w

    for kind in ('synth_pulse', 'synth_nes_triangle', 'synth_pad_chord', 'synth_chime'):
        ns[kind] = wrap(kind, ns[kind])

    o_add = ns['add_to_track']
    names = {}

    def add_to_track(track, signal, start_beat):
        i = getattr(signal, 'ev', None)
        if i is not None and len(signal):
            if not names:
                names.update({id(ns[k]): k for k in ('lead_L', 'lead_R', 'pad_L', 'pad_R', 'bass_M', 'harm_L', 'harm_R')})
            o = origs[i]
            j = int(np.argmax(np.abs(o[:len(signal)])))
            events[i]['place'].append((names[id(track)], float(start_beat), float(signal[j] / o[j])))
        return o_add(track, np.asarray(signal), start_beat)

    ns['add_to_track'] = add_to_track
    exec(compile(body, str(path), 'exec'), ns)
    ns['add_to_track'] = o_add
    exec(compile(mixdown, str(path), 'exec'), ns)

    out = []
    for ev in events:
        a = ev['args']
        pl = ev['place']
        if not pl:
            continue
        starts = {p[1] for p in pl}
        assert len(starts) == 1, ev
        sb = starts.pop()
        g = {'L': 0.0, 'R': 0.0}; lead = False
        for tr, _, gain in pl:
            if tr == 'bass_M':
                g['L'] += 0.707 * gain; g['R'] += 0.707 * gain
            else:
                g[tr[-1]] += gain; lead = lead or tr.startswith('lead')
        t0 = round(sb * BEAT * SR) / SR   # 和脚本一样按采样取整
        env = ev['adsr'][0]
        envl = [r(env['attack']), r(env['decay']), r(env['sustain']), r(env['release']), r(env['exp_decay'])]
        n = int(round(a['dur_sec'] * SR)); dur = n / SR
        common = [r(t0, 9), r(dur, 7)]
        gl = [r(g['L']), r(g['R']), 1 if lead else 0]
        if ev['kind'] == 'synth_pulse':
            vib = [r(a['vibrato_hz']), r(a['vibrato_cents']), r(a['vibrato_delay'])]
            assert ev['filt'] == ['lf'] and len(ev['cut']) == 1
            out.append(['p'] + common + [r(a['freq']), r(a['duty']), r(a['amp']), r(ev['cut'][0])] + envl + vib + gl)
        elif ev['kind'] == 'synth_nes_triangle':
            out.append(['t'] + common + [r(a['freq']), r(a['amp'])] + envl + gl)
        elif ev['kind'] == 'synth_chime':
            assert ev['filt'] == ['lf'] and len(ev['cut']) == 1
            out.append(['c'] + common + [r(a['freq']), r(a['amp']), r(ev['cut'][0])] + envl + gl)
        else:
            assert ev['filt'] == ['ff'] and len(ev['cut']) == 1
            freqs = [r(ns['note_to_freq'](x)) for x in a['notes'] if ns['note_to_freq'](x) > 0]
            out.append(['d'] + common + [freqs, r(a['duty']), r(a['amp']), r(ev['cut'][0])] + envl + gl)
    out.sort(key=lambda e: e[1])
    total = ns['TOTAL_SAMPLES'] / SR
    return {
        'total': r(total, 9),
        'echo': [r(round(float(echo.group(1)) * BEAT * SR) / SR, 9), r(float(echo.group(3))),
                 r(round(float(echo.group(2)) * BEAT * SR) / SR, 9), r(float(echo.group(4)))],
        'lpf': float(lpf.group(1)),
        'fade': [r(int(float(fade.group(1)) * SR) / SR, 9), float(fade.group(2))],
        'master': r(float(target.group(1)) / float(ns['peak'])),   # 峰值归一化系数（不含 DAC 那一步）
        'chime': [float(chime.group(1)), float(chime.group(2)), float(chime.group(3))],
        'events': out,
    }


def main():
    scores = {}
    cwd = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)   # 脚本会建 ./output
        try:
            for key, script in JOBS:
                scores[key] = extract(SRC / script)
                kinds = {}
                for e in scores[key]['events']:
                    kinds[e[0]] = kinds.get(e[0], 0) + 1
                print(key, script, f"{scores[key]['total']:.1f}s", kinds, 'master', scores[key]['master'])
        finally:
            os.chdir(cwd)
    bgm = ROOT / 'bgm.js'
    s = bgm.read_text(encoding='utf-8')
    line = 'const DREAM_SCORES = ' + json.dumps(scores, ensure_ascii=False, separators=(',', ':')) + ';'
    s, n = re.subn(r'^  const DREAM_SCORES = .*;$', lambda m: '  ' + line, s, flags=re.M)
    if n != 1:
        sys.exit(f'bgm.js 里没找到唯一一行 const DREAM_SCORES = ...（找到 {n} 处）')
    bgm.write_text(s, encoding='utf-8')
    print(f'写进 bgm.js：{len(line) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
