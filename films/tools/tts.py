#!/usr/bin/env python3
"""Narration builder: reads narration/<film>.script.json, synthesises each line with a local Kokoro
voice (no outside service), and writes narration/<film>.json with durations and embedded MP3 audio.

  python tools/tts.py <film> [--models DIR] [--check]
"""
import base64, json, os, subprocess, sys, tempfile
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

film = sys.argv[1]
models = sys.argv[sys.argv.index('--models') + 1] if '--models' in sys.argv else os.environ.get('KOKORO_MODELS', 'models')
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
script = json.load(open(os.path.join(root, 'narration', f'{film}.script.json')))
k = Kokoro(os.path.join(models, 'kokoro-v1.0.onnx'), os.path.join(models, 'voices-v1.0.bin'))
voice, speed = script.get('voice', 'am_michael'), script.get('speed', 1.0)
if isinstance(voice, dict):  # blend: {"am_michael": 0.6, "am_fenrir": 0.4}
    voice = sum(k.get_voice_style(n) * w for n, w in voice.items())

out, tmp = [], tempfile.mkdtemp()
for i, line in enumerate(script['lines']):
    if '--check' in sys.argv:
        print(line['id'], k.tokenizer.phonemize(line.get('say', line['text']), 'en-us')); continue
    s, sr = k.create(line.get('say', line['text']), voice=voice, speed=line.get('speed', speed), lang='en-us')
    s = np.asarray(s, dtype=np.float32)
    # trim leading / trailing silence
    idx = np.where(np.abs(s) > 0.008)[0]
    if len(idx): s = s[max(0, idx[0] - int(0.02 * sr)): idx[-1] + int(0.10 * sr)]
    # level to a common RMS, guard the peak
    rms = float(np.sqrt(np.mean(s ** 2)) + 1e-9); s = s * (0.085 / rms)
    pk = float(np.max(np.abs(s))); s = s * min(1.0, 0.92 / pk)
    wav, mp3 = os.path.join(tmp, f'{i}.wav'), os.path.join(tmp, f'{i}.mp3')
    sf.write(wav, s, sr)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-ar', '48000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '72k', mp3], check=True)
    dur = len(s) / sr
    out.append({'id': line['id'], 't': line['t'], 'text': line['text'], 'dur': round(dur, 3), 'audio': base64.b64encode(open(mp3, 'rb').read()).decode()})
    nxt = script['lines'][i + 1]['t'] if i + 1 < len(script['lines']) else None
    gap = '' if nxt is None else f'  gap to next {nxt - (line["t"] + dur):+.2f}s' + ('  << OVERLAP' if nxt - (line['t'] + dur) < 0.15 else '')
    print(f'{line["id"]}  t={line["t"]:6.2f}  dur={dur:5.2f}  end={line["t"] + dur:6.2f}{gap}')
if '--check' not in sys.argv:
    json.dump({'voice': script.get('voice'), 'lines': out}, open(os.path.join(root, 'narration', f'{film}.json'), 'w'))
    print('wrote', f'narration/{film}.json', round(sum(len(l['audio']) for l in out) / 1e6, 2), 'MB base64')
