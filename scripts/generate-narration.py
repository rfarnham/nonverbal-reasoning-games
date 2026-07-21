#!/usr/bin/env python3
"""Render the suite's pinned Kokoro narrator into local gameplay clips.

Install the build-only dependencies in a temporary environment:
  python -m pip install kokoro==0.9.4 "misaki[en]" soundfile huggingface-hub

Kokoro is never loaded by the game. The checked-in MP3 files are the only
runtime artifacts, so narration remains private, same-origin, and consistent.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import hf_hub_download
from kokoro import KModel, KPipeline


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "content/narration/libra-proof.json"
DEFAULT_OUTPUT = ROOT / "public/audio/narration/kokoro-82m-v1-af-heart"
UNLOCK_OUTPUT = ROOT / "public/audio/narration/narration-unlock.mp3"


def render_unlock_clip(sample_rate: int) -> None:
    """Create the silent same-element WebKit unlock clip."""
    UNLOCK_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"anullsrc=r={sample_rate}:cl=mono",
            "-t",
            "0.18",
            "-ac",
            "1",
            "-b:a",
            "48k",
            str(UNLOCK_OUTPUT),
        ],
        check=True,
    )


def render(manifest_path: Path, output_dir: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    narrator = manifest["narrator"]
    repo_id = narrator["model"]
    revision = narrator["revision"]
    voice = narrator["voice"]
    sample_rate = int(narrator["sampleRate"])
    speed = float(narrator["speed"])
    render_unlock_clip(sample_rate)

    config_path = hf_hub_download(
        repo_id=repo_id, filename="config.json", revision=revision
    )
    model_path = hf_hub_download(
        repo_id=repo_id, filename="kokoro-v1_0.pth", revision=revision
    )
    voice_path = hf_hub_download(
        repo_id=repo_id, filename=f"voices/{voice}.pt", revision=revision
    )

    model = KModel(repo_id=repo_id, config=config_path, model=model_path)
    model = model.to("cpu").eval()
    pipeline = KPipeline(lang_code="a", repo_id=repo_id, model=model, device="cpu")
    voice_pack = torch.load(voice_path, map_location="cpu", weights_only=True)

    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="spatial-gym-narration-") as temp:
        temp_dir = Path(temp)
        for cue_id, cue in manifest["cues"].items():
            chunks = [
                result.audio.detach().cpu().numpy()
                for result in pipeline(
                    cue["speechText"],
                    voice=voice_pack,
                    speed=speed,
                    split_pattern=r"\n+",
                )
                if result.audio is not None
            ]
            if not chunks:
                raise RuntimeError(f"Kokoro produced no audio for {cue_id}")

            audio = np.concatenate(chunks).astype(np.float32)
            wav_path = temp_dir / f"{cue_id}.wav"
            destination = output_dir / cue["file"]
            sf.write(wav_path, audio, sample_rate, subtype="PCM_16")
            subprocess.run(
                [
                    "ffmpeg",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(wav_path),
                    "-ac",
                    "1",
                    "-b:a",
                    "48k",
                    str(destination),
                ],
                check=True,
            )
            cue["audioDurationMs"] = round(len(audio) / sample_rate * 1000)
            cue["sha256"] = hashlib.sha256(destination.read_bytes()).hexdigest()
            print(f"{cue_id}: {cue['audioDurationMs']} ms -> {destination.name}")

    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    render(args.manifest.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
