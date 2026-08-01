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
def probe_audio_duration_ms(path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return round(float(result.stdout.strip()) * 1000)


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


def render(
    manifest_path: Path,
    output_dir: Path,
    selected_cue_ids: frozenset[str] | None = None,
) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    narrator = manifest["narrator"]
    repo_id = narrator["model"]
    revision = narrator["revision"]
    voice = narrator["voice"]
    sample_rate = int(narrator["sampleRate"])
    speed = float(narrator["speed"])
    postprocess = manifest.get("postprocess", {})
    trim_edge_silence = bool(postprocess.get("trimEdgeSilence", False))
    trim_edge_silence_filter = postprocess.get("ffmpegAudioFilter")
    trim_audio_codec = postprocess.get("ffmpegAudioCodec")
    trim_audio_bitrate = postprocess.get("audioBitrateKbps")
    if trim_edge_silence:
        if not isinstance(trim_edge_silence_filter, str):
            raise ValueError(
                "trimEdgeSilence requires an audited ffmpegAudioFilter recipe"
            )
        if not isinstance(trim_audio_codec, str):
            raise ValueError(
                "trimEdgeSilence requires an audited ffmpegAudioCodec"
            )
        if not isinstance(trim_audio_bitrate, int) or trim_audio_bitrate <= 0:
            raise ValueError(
                "trimEdgeSilence requires a positive audioBitrateKbps"
            )
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
        available_cues = manifest["cues"]
        if selected_cue_ids:
            missing = selected_cue_ids.difference(available_cues)
            if missing:
                raise KeyError(
                    f"Unknown narration cue(s): {', '.join(sorted(missing))}"
                )
        for cue_id, cue in available_cues.items():
            if selected_cue_ids and cue_id not in selected_cue_ids:
                continue
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
            ffmpeg_command = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(wav_path),
            ]
            if trim_edge_silence:
                ffmpeg_command.extend(["-af", trim_edge_silence_filter])
                ffmpeg_command.extend(["-c:a", trim_audio_codec])
            ffmpeg_command.extend(
                [
                    "-ac",
                    "1",
                    "-b:a",
                    (
                        f"{trim_audio_bitrate}k"
                        if trim_edge_silence
                        else "48k"
                    ),
                    str(destination),
                ]
            )
            subprocess.run(ffmpeg_command, check=True)
            cue["audioDurationMs"] = (
                probe_audio_duration_ms(destination)
                if trim_edge_silence
                else round(len(audio) / sample_rate * 1000)
            )
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
    parser.add_argument(
        "--cue",
        action="append",
        default=[],
        help="Render only this cue ID. Repeat for multiple cues.",
    )
    args = parser.parse_args()
    selected_cues = frozenset(args.cue) or None
    render(
        args.manifest.resolve(),
        args.output.resolve(),
        selected_cues,
    )


if __name__ == "__main__":
    main()
