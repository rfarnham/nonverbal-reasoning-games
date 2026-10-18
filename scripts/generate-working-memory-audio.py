#!/usr/bin/env python3
"""Render one contextual digit list, then extract complete interior words.

Build-only dependencies match scripts/generate-narration.py. Keep --output
outside the public repository; refresh-working-memory-audio.mjs encrypts it.
The model, revision, voice and speed remain the shared suite narrator.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import hf_hub_download
from kokoro import KModel, KPipeline
from misaki.en import MToken


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "content/narration/working-memory.json"
# Three lead-in and three trailing words keep every selected occurrence away
# from utterance boundaries. Explicit tokens avoid Misaki occasionally merging
# ellipses into a word and silently discarding its pause punctuation.
WORDS = ["seven", "eight", "nine", "one", "two", "three", "four", "five",
         "six", "seven", "eight", "nine", "one", "two", "three"]
PHONES = {"one": "wˈʌn", "two": "tˈu", "three": "θɹˈi", "four": "fˈɔɹ",
          "five": "fˈIv", "six": "sˈɪks", "seven": "sˈɛvən", "eight": "ˈAt", "nine": "nˈIn"}
TARGETS = {str(digit): digit + 2 for digit in range(1, 10)}


def quiet_boundary(audio: np.ndarray, rate: int, left: float, right: float) -> tuple[int, float]:
    """Find an actual silent 20 ms window in the aligned punctuation gap.

    Timestamps are approximate, so retain up to 35/45 ms on either side of
    the predicted gap. Reject an unsafe source instead of clipping a phoneme.
    """
    half_window = round(rate * 0.01)
    begin = max(half_window, round((left - 0.035) * rate))
    end = min(len(audio) - half_window - 1, round((right + 0.045) * rate))
    if end <= begin:
        raise ValueError("The contextual word alignment has no safe gap")
    centers = np.arange(begin, end + 1)
    squared = np.concatenate(([0.0], np.cumsum(audio.astype(np.float64) ** 2)))
    energy = (squared[centers + half_window] - squared[centers - half_window]) / (2 * half_window)
    # Prefer a central gap when several candidates are numerically silent.
    best = int(np.argmin(energy + np.abs(centers - (begin + end) / 2) * 1e-15))
    rms_db = float(10 * np.log10(max(float(energy[best]), 1e-16)))
    if rms_db > -52:
        raise ValueError(f"No quiet cut between contextual words ({rms_db:.1f} dBFS)")
    return int(centers[best]), rms_db


def render(manifest_path: Path, output: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    narrator = manifest["narrator"]
    rate = int(narrator["sampleRate"])
    if rate != 24000:
        raise ValueError("The pinned Kokoro model emits 24 kHz audio")
    torch.manual_seed(0)
    torch.set_num_threads(2)
    repo, revision = narrator["model"], narrator["revision"]
    config = hf_hub_download(repo_id=repo, filename="config.json", revision=revision)
    weights = hf_hub_download(repo_id=repo, filename="kokoro-v1_0.pth", revision=revision)
    voice_file = hf_hub_download(repo_id=repo, filename=f"voices/{narrator['voice']}.pt", revision=revision)
    model = KModel(repo_id=repo, config=config, model=weights).to("cpu").eval()
    pipeline = KPipeline(lang_code="a", repo_id=repo, model=model, device="cpu")
    voice = torch.load(voice_file, map_location="cpu", weights_only=True)
    tokens = []
    for index, word in enumerate(WORDS):
        tokens.append(MToken(word, "NN", "", phonemes=PHONES[word]))
        pause_length = 3 if index + 1 < len(WORDS) else 1
        for mark in range(pause_length):
            space = " " if mark == pause_length - 1 and index + 1 < len(WORDS) else ""
            tokens.append(MToken(".", ".", space, phonemes="."))
    results = list(pipeline.generate_from_tokens(tokens, voice=voice, speed=float(narrator["speed"])))
    if len(results) != 1 or results[0].audio is None:
        raise ValueError("The whole context must be rendered in one inference")
    result = results[0]
    source = result.audio.detach().cpu().numpy().astype(np.float64)
    words = [token for token in result.tokens if token.text in PHONES]
    if len(words) != len(WORDS) or any(token.start_ts is None or token.end_ts is None for token in words):
        raise ValueError("Incomplete source alignment")
    cuts = [quiet_boundary(source, rate, left.end_ts, right.start_ts)
            for left, right in zip(words, words[1:])]
    gain = (10 ** (-3 / 20)) / float(np.max(np.abs(source)))
    source *= gain  # One shared gain; never normalize words individually.
    output.mkdir(parents=True, exist_ok=True)
    source_path = output / "context-source.wav"
    sf.write(source_path, source, rate, subtype="PCM_24")
    manifest["generation"] = {
        "method": "single-context-interior-word-extraction",
        "package": "kokoro==0.9.4", "seed": 0, "cpuThreads": 2,
        "sourceText": "... ".join(WORDS) + ".", "sourcePhonemes": result.phonemes,
        "sourceSha256": hashlib.sha256(source_path.read_bytes()).hexdigest(),
        "sourceDurationMs": round(len(source) / rate * 1000),
        "sourcePeakDbfs": -3,
    }
    manifest["postprocess"] = {
        "trimEdgeSilence": False,
        "boundaryWindowMs": 20, "maximumBoundaryRmsDbfs": -52,
        "boundaryRmsMeasurement": "before-shared-peak-adjustment",
        "paddingMs": 35, "boundaryFadeMs": 5,
        "ffmpegAudioCodec": "libmp3lame", "audioBitrateKbps": 160,
    }
    padding, fade = round(rate * 0.035), round(rate * 0.005)
    for digit, index in TARGETS.items():
        begin, begin_db = cuts[index - 1]
        end, end_db = cuts[index]
        word = source[begin:end].copy()
        word[:fade] *= np.linspace(0, 1, fade)
        word[-fade:] *= np.linspace(1, 0, fade)
        clip = np.pad(word, (padding, padding))
        cue = manifest["cues"][digit]
        wave_path = output / f"digit-{digit}.wav"
        destination = output / cue["file"]
        sf.write(wave_path, clip, rate, subtype="PCM_24")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(wave_path),
                        "-c:a", "libmp3lame", "-b:a", "160k", "-ar", str(rate), "-ac", "1", str(destination)], check=True)
        decoded = subprocess.run(["ffmpeg", "-v", "error", "-i", str(destination), "-f", "f32le", "-"],
                                 check=True, capture_output=True)
        samples = np.frombuffer(decoded.stdout, dtype="<f4")
        edge = round(rate * 0.02)
        if len(samples) < 2 * edge or np.max(np.abs(np.r_[samples[:edge], samples[-edge:]])) > 10 ** (-65 / 20):
            raise ValueError(f"Encoded {digit} has a non-silent playback boundary")
        if np.max(np.abs(samples)) >= 0.99 or np.sqrt(np.mean(samples ** 2)) < 0.005:
            raise ValueError(f"Encoded {digit} is clipped or unexpectedly quiet")
        probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                str(destination)], check=True, capture_output=True, text=True)
        cue.update({"speechText": WORDS[index], "audioDurationMs": round(float(probe.stdout.strip()) * 1000),
                    "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                    "sourceTokenIndex": index, "sourceStartSample": begin, "sourceEndSample": end,
                    "boundaryRmsDbfs": [round(begin_db, 2), round(end_db, 2)]})
        print(f"{digit}: {cue['audioDurationMs']} ms, source {begin}:{end}, boundaries {begin_db:.1f}/{end_db:.1f} dBFS")
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    render(arguments.manifest.resolve(), arguments.output.resolve())
