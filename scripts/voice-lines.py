"""
Voice made-up lines and time their words, for designing scenes locally.

    python3 scripts/voice-lines.py lines.txt out/voices

`lines.txt` holds one `name|line` per row. For each it writes, into the out
directory:

  - `<name>.mp4`   a 1080x1920 clip with the line spoken over a plain frame
                   (0.4 s of silence first, 0.6 s after), to pass to
                   `scripts/scene-preview.ts --voice`;
  - `words.json`   `{ name: [{text, atSec}] }`, merged with what is there,
                   to pass as `--words out/voices/words.json:<name>`.

The timings come from transcribing the clip, not from the text, so a beat
lands where the live pipeline — which also transcribes — will put it.

Needs a virtualenv with `piper-tts`, `faster-whisper` and `numpy`, a Piper
voice (`en_US-ryan-high.onnx` and its `.json`, from huggingface.co/rhasspy/
piper-voices), and ffmpeg (the repo's `ffmpeg-static` works). Set PIPER_VOICE
and FFMPEG if they are not in the current directory and on PATH. See
`.claude/skills/scene-design/SKILL.md`.
"""

import json
import os
import subprocess
import sys

import numpy as np
from faster_whisper import WhisperModel


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    lines_path, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    ffmpeg = os.environ.get("FFMPEG", "ffmpeg")
    voice = os.environ.get("PIPER_VOICE", "en_US-ryan-high.onnx")
    piper = os.path.join(os.path.dirname(sys.executable), "piper")
    model = WhisperModel("base.en", device="cpu", compute_type="int8")

    words_path = os.path.join(out, "words.json")
    words = json.load(open(words_path)) if os.path.exists(words_path) else {}

    for row in open(lines_path):
        row = row.strip()
        if not row or row.startswith("#"):
            continue
        name, line = row.split("|", 1)
        wav, mp4 = os.path.join(out, f"{name}.wav"), os.path.join(out, f"{name}.mp4")
        subprocess.run([piper, "-m", voice, "-f", wav], input=line.encode(), capture_output=True, check=True)
        subprocess.run(
            [ffmpeg, "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x2a2a30:s=1080x1920:r=30",
             "-i", wav, "-af", "adelay=400|400,apad=pad_dur=0.6", "-shortest",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", "-c:a", "aac", mp4],
            check=True,
        )
        raw = subprocess.run(
            [ffmpeg, "-nostdin", "-v", "error", "-i", mp4, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
            capture_output=True, check=True,
        ).stdout
        segments, _ = model.transcribe(np.frombuffer(raw, dtype=np.float32), word_timestamps=True)
        words[name] = [{"text": w.word.strip(), "atSec": round(w.start, 2)} for s in segments for w in s.words]
        print(name, " ".join(f"{w['text']}@{w['atSec']}" for w in words[name]))

    with open(words_path, "w") as f:
        json.dump(words, f)


if __name__ == "__main__":
    main()
