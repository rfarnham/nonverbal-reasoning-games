#!/usr/bin/env python3
"""Explicit maintenance command; downloads pinned sources, never player audio.

Usage: python3 scripts/prepare-local-digit-speech.py /path/to/download-cache
Model and WASM asset outputs are deterministic. Notices are retained separately.
"""
import base64
import gzip
import hashlib
import io
from pathlib import Path
import re
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/models/speech"
HEADER = "/* Derived from vosk-browser 0.0.8 (Apache-2.0). Embedded WASM and dependency notices retained.\n * Only change: final flush emits finalresult, distinct from streaming endpoints. See NOTICE.md. */\n"
SOURCES = {
    "model.zip": ("https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip", "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"),
    "vosk-browser-0.0.8.tgz": ("https://registry.npmjs.org/vosk-browser/-/vosk-browser-0.0.8.tgz", "fd16fc7e64c935d7a79cf07c8f67d84232b6485376a59144af8a234979a9a4b4"),
}


def source(cache, name):
    url, expected = SOURCES[name]
    path = cache / name
    if not path.exists():
        with urllib.request.urlopen(url, timeout=120) as response:
            path.write_bytes(response.read())
    value = path.read_bytes()
    if hashlib.sha256(value).hexdigest() != expected:
        raise ValueError(f"Source hash mismatch: {name}")
    return value


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    cache = Path(sys.argv[1]).resolve()
    cache.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archive = zipfile.ZipFile(io.BytesIO(source(cache, "model.zip")))
    entries = sorted(archive.infolist(), key=lambda entry: entry.filename)
    # Keep directory entries: upstream's libarchive→IDBFS extraction needs them.
    with (OUTPUT / "vosk-model-small-en-us-0.15.tar.gz").open("wb") as target:
        with gzip.GzipFile(filename="", fileobj=target, mode="wb", mtime=0, compresslevel=9) as zipped:
            with tarfile.open(fileobj=zipped, mode="w", format=tarfile.USTAR_FORMAT) as tar:
                for entry in entries:
                    relative = entry.filename.removeprefix("vosk-model-small-en-us-0.15/").rstrip("/")
                    info = tarfile.TarInfo("model" + ("/" + relative if relative else ""))
                    info.mtime = 1607385600
                    if entry.is_dir():
                        info.type = tarfile.DIRTYPE
                        info.mode = 0o755
                        tar.addfile(info)
                    else:
                        value = archive.read(entry)
                        info.mode = 0o644
                        info.size = len(value)
                        tar.addfile(info, io.BytesIO(value))
    with tarfile.open(fileobj=io.BytesIO(source(cache, "vosk-browser-0.0.8.tgz")), mode="r:gz") as package:
        runtime = package.extractfile("package/dist/vosk.js").read().decode()
    worker = base64.b64decode(re.search(r"WorkerFactory = createBase64WorkerFactory\('([^']+)'", runtime).group(1)).decode()
    start = worker.index("        retrieveFinalResult(recognizerId)")
    end = worker.index("        removeRecognizer(", start)
    section = worker[start:end]
    assert section.count('event: "result"') == 1
    worker = worker[:start] + section.replace('event: "result"', 'event: "finalresult"') + worker[end:]
    (OUTPUT / "vosk-worker-v0.0.8.js").write_text(HEADER + worker)
    for path in [OUTPUT / "vosk-model-small-en-us-0.15.tar.gz", OUTPUT / "vosk-worker-v0.0.8.js"]:
        print(path.relative_to(ROOT), path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
