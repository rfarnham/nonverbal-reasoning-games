#!/usr/bin/env python3
"""Pack or restore only the arcade's encrypted vault; never decrypt its files."""

import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import tarfile
import tempfile
import uuid

REPO = Path(__file__).resolve().parent.parent
VAULT = REPO / "public/homework-arcade/vault"
ARCHIVE = REPO / "work/homework-arcade-ciphertext"
ARCHIVE_MANIFEST = "archive-manifest.json"
CHUNK_BYTES = 16 * 1024 * 1024
MAX_FILE_BYTES = 50 * 1024 * 1024 - 1
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
MAX_MEMBERS = 4096
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
BUFFER_BYTES = 1024 * 1024
MEMBER_RE = re.compile(r"(?:manifest\.json|[a-f0-9]{32}\.bin)\Z")
PART_RE = re.compile(r"part-[0-9]{4}\.bin\Z")
HASH_RE = re.compile(r"[a-f0-9]{64}\Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def open_regular(path):
    """Refuse symlinks, devices, FIFOs, and other nonregular inputs."""
    require(stat.S_ISREG(path.lstat().st_mode), "Input must be a regular file")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "Input must be a regular file")
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def digest_file(path):
    digest, size = hashlib.sha256(), 0
    with open_regular(path) as stream:
        for block in iter(lambda: stream.read(BUFFER_BYTES), b""):
            size += len(block)
            require(size <= MAX_FILE_BYTES, "Vault file exceeds size bound")
            digest.update(block)
    return size, digest.hexdigest()


def load_json(path, maximum=MAX_MANIFEST_BYTES):
    with open_regular(path) as stream:
        raw = stream.read(maximum + 1)
    require(len(raw) <= maximum, "Manifest exceeds size bound")

    def unique_object(pairs):
        result = {}
        for name, value in pairs:
            require(name not in result, "Duplicate JSON key")
            result[name] = value
        return result

    return json.loads(raw, object_pairs_hook=unique_object)


def validate_vault_manifest(path, member_names):
    value = load_json(path, 65536)
    require(isinstance(value, dict) and set(value) == {
        "version", "algorithm", "kdf", "iterations", "salt", "content"
    }, "Unexpected vault manifest fields")
    require(value["version"] == 1 and value["algorithm"] == "AES-256-GCM"
            and value["kdf"] == "PBKDF2-SHA-256" and value["iterations"] == 600000,
            "Unsupported vault encryption metadata")
    require(isinstance(value["salt"], str)
            and len(base64.b64decode(value["salt"], validate=True)) == 16,
            "Invalid vault salt")
    content = value["content"]
    require(isinstance(content, dict) and set(content) == {"id", "file", "mime"},
            "Unexpected content descriptor fields")
    require(isinstance(content["id"], str)
            and re.fullmatch(r"[a-f0-9]{32}", content["id"])
            and content["file"] == f"vault/{content['id']}.bin"
            and content["mime"] == "application/json"
            and f"{content['id']}.bin" in member_names,
            "Invalid encrypted content descriptor")


def inspect_vault(path):
    require(path.is_dir() and not path.is_symlink(), "Vault must be a directory")
    names = sorted(entry.name for entry in path.iterdir())
    require(2 <= len(names) <= MAX_MEMBERS and "manifest.json" in names,
            "Invalid vault member count")
    require(all(MEMBER_RE.fullmatch(name) for name in names),
            "Vault contains an unexpected filename")
    members, total = [], 0
    for name in ["manifest.json"] + [n for n in names if n != "manifest.json"]:
        size, digest = digest_file(path / name)
        require(size > 0 and (name == "manifest.json" or size >= 28),
                "Incomplete vault file")
        total += size
        require(total <= MAX_ARCHIVE_BYTES, "Vault exceeds archive size bound")
        members.append({"name": name, "size": size, "sha256": digest})
    validate_vault_manifest(path / "manifest.json", set(names))
    return members


def replace_directory(staging, destination, kind):
    """Replace a known generated directory, preserving it on rename failure."""
    backup = None
    if destination.exists() or destination.is_symlink():
        require(destination.is_dir() and not destination.is_symlink(),
                "Refusing to replace a non-directory or symlink")
        if kind == "vault":
            inspect_vault(destination)
        else:
            validate_archive_manifest(destination)
            require(all(entry.is_file() and not entry.is_symlink()
                        and (entry.name == ARCHIVE_MANIFEST or PART_RE.fullmatch(entry.name))
                        for entry in destination.iterdir()),
                    "Refusing to replace an unknown archive directory")
        backup = destination.with_name(f".{destination.name}-previous-{uuid.uuid4().hex}")
        os.replace(destination, backup)
    try:
        os.replace(staging, destination)
    except BaseException:
        if backup is not None:
            os.replace(backup, destination)
        raise
    if backup is not None:
        shutil.rmtree(backup)


class ChunkWriter:
    def __init__(self, directory):
        self.directory = directory
        self.stream = None
        self.part_digest = None
        self.part_size = 0
        self.total = 0
        self.digest = hashlib.sha256()
        self.parts = []

    def finish_part(self):
        if self.stream is not None:
            self.stream.close()
            self.parts.append({"name": f"part-{len(self.parts) + 1:04d}.bin",
                               "size": self.part_size,
                               "sha256": self.part_digest.hexdigest()})
            self.stream = None

    def write(self, data):
        require(self.total + len(data) <= MAX_ARCHIVE_BYTES,
                "Tar archive exceeds size bound")
        self.total += len(data)
        self.digest.update(data)
        remaining = memoryview(data)
        while remaining:
            if self.stream is None:
                self.stream = (self.directory / f"part-{len(self.parts) + 1:04d}.bin").open("xb")
                self.part_digest, self.part_size = hashlib.sha256(), 0
            amount = min(len(remaining), CHUNK_BYTES - self.part_size)
            block, remaining = remaining[:amount], remaining[amount:]
            self.stream.write(block)
            self.part_digest.update(block)
            self.part_size += amount
            if self.part_size == CHUNK_BYTES:
                self.finish_part()
        return len(data)

    def close(self):
        self.finish_part()


def pack(archive_dir):
    members = inspect_vault(VAULT)
    archive_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".homework-vault-pack-", dir=archive_dir.parent))
    writer = ChunkWriter(staging)
    try:
        with tarfile.open(fileobj=writer, mode="w|", format=tarfile.USTAR_FORMAT) as archive:
            for member in members:
                info = tarfile.TarInfo(member["name"])
                info.size, info.mode, info.mtime = member["size"], 0o644, 0
                info.uid = info.gid = 0
                with open_regular(VAULT / member["name"]) as stream:
                    archive.addfile(info, stream)
        writer.close()
        # Detect a source update while the tar was being written.
        require(inspect_vault(VAULT) == members, "Vault changed during packing")
        manifest = {"schemaVersion": 1, "format": "tar", "chunkSize": CHUNK_BYTES,
                    "archive": {"size": writer.total, "sha256": writer.digest.hexdigest()},
                    "parts": writer.parts, "members": members}
        (staging / ARCHIVE_MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n")
        validate_archive_manifest(staging)
        replace_directory(staging, archive_dir, "archive")
        return {"members": len(members), "ciphertextFiles": len(members) - 1,
                "parts": len(writer.parts), "archiveBytes": writer.total,
                "maxPartBytes": max(part["size"] for part in writer.parts),
                "archiveSha256": manifest["archive"]["sha256"]}
    finally:
        writer.close()
        if staging.exists():
            shutil.rmtree(staging)


def validate_archive_manifest(directory):
    require(directory.is_dir() and not directory.is_symlink(), "Archive must be a directory")
    value = load_json(directory / ARCHIVE_MANIFEST)
    require(isinstance(value, dict) and set(value) == {
        "schemaVersion", "format", "chunkSize", "archive", "parts", "members"
    }, "Unexpected archive manifest fields")
    require(value["schemaVersion"] == 1 and value["format"] == "tar"
            and value["chunkSize"] == CHUNK_BYTES, "Unsupported archive format")
    archive = value["archive"]
    require(isinstance(archive, dict) and set(archive) == {"size", "sha256"}
            and type(archive["size"]) is int and 1024 <= archive["size"] <= MAX_ARCHIVE_BYTES
            and isinstance(archive["sha256"], str) and HASH_RE.fullmatch(archive["sha256"]),
            "Invalid archive descriptor")
    parts, members = value["parts"], value["members"]
    require(isinstance(parts, list) and len(parts) == math.ceil(archive["size"] / CHUNK_BYTES),
            "Invalid part count")
    for i, part in enumerate(parts):
        expected_size = min(CHUNK_BYTES, archive["size"] - i * CHUNK_BYTES)
        require(isinstance(part, dict) and set(part) == {"name", "size", "sha256"}
                and part["name"] == f"part-{i + 1:04d}.bin"
                and type(part["size"]) is int and part["size"] == expected_size
                and isinstance(part["sha256"], str) and HASH_RE.fullmatch(part["sha256"]),
                "Invalid archive part descriptor")
    require(isinstance(members, list) and 2 <= len(members) <= MAX_MEMBERS,
            "Invalid member count")
    names, total = set(), 0
    for member in members:
        require(isinstance(member, dict) and set(member) == {"name", "size", "sha256"}
                and isinstance(member["name"], str) and MEMBER_RE.fullmatch(member["name"])
                and member["name"] not in names and type(member["size"]) is int
                and 0 < member["size"] <= MAX_FILE_BYTES
                and (member["name"] == "manifest.json" or member["size"] >= 28)
                and isinstance(member["sha256"], str) and HASH_RE.fullmatch(member["sha256"]),
                "Invalid or duplicate archive member descriptor")
        names.add(member["name"])
        total += member["size"]
    require("manifest.json" in names and total <= archive["size"], "Invalid member totals")
    return value


def unpack(archive_dir, output_dir):
    manifest = validate_archive_manifest(archive_dir)
    expected_files = {ARCHIVE_MANIFEST, *(p["name"] for p in manifest["parts"])}
    require({p.name for p in archive_dir.iterdir()} == expected_files,
            "Unexpected archive directory entries")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".homework-vault-unpack-", dir=output_dir.parent))
    try:
        with tempfile.TemporaryFile() as joined:
            overall = hashlib.sha256()
            for part in manifest["parts"]:
                digest, size = hashlib.sha256(), 0
                with open_regular(archive_dir / part["name"]) as stream:
                    for block in iter(lambda: stream.read(BUFFER_BYTES), b""):
                        size += len(block)
                        require(size <= part["size"], "Archive part exceeds declared size")
                        digest.update(block)
                        overall.update(block)
                        joined.write(block)
                require(size == part["size"] and digest.hexdigest() == part["sha256"],
                        "Archive part integrity check failed")
            require(joined.tell() == manifest["archive"]["size"]
                    and overall.hexdigest() == manifest["archive"]["sha256"],
                    "Whole archive integrity check failed")
            joined.seek(0)
            expected = {m["name"]: m for m in manifest["members"]}
            seen, next_offset = set(), 0
            with tarfile.open(fileobj=joined, mode="r:") as archive:
                for info in archive:
                    require(info.type in (tarfile.REGTYPE, tarfile.AREGTYPE)
                            and MEMBER_RE.fullmatch(info.name) and info.name in expected
                            and info.name not in seen and not info.pax_headers
                            and not info.issparse() and info.offset == next_offset
                            and info.offset_data == info.offset + tarfile.BLOCKSIZE,
                            "Unsafe, unexpected, or duplicate tar member")
                    member = expected[info.name]
                    require(info.size == member["size"], "Tar member size mismatch")
                    digest, size = hashlib.sha256(), 0
                    source = archive.extractfile(info)
                    require(source is not None, "Tar member is unreadable")
                    with source, (staging / info.name).open("xb") as destination:
                        for block in iter(lambda: source.read(BUFFER_BYTES), b""):
                            size += len(block)
                            require(size <= member["size"], "Tar member exceeds declared size")
                            digest.update(block)
                            destination.write(block)
                    require(size == member["size"] and digest.hexdigest() == member["sha256"],
                            "Tar member integrity check failed")
                    seen.add(info.name)
                    next_offset = info.offset_data + math.ceil(info.size / 512) * 512
            require(seen == set(expected), "Tar member set mismatch")
            joined.seek(next_offset)
            suffix = joined.read(tarfile.RECORDSIZE + 1025)
            require(1024 <= len(suffix) <= tarfile.RECORDSIZE + 1024
                    and not any(suffix) and joined.tell() == manifest["archive"]["size"]
                    and manifest["archive"]["size"] % tarfile.RECORDSIZE == 0,
                    "Invalid tar termination or trailing bytes")
        restored = inspect_vault(staging)
        require({m["name"]: m for m in restored} == expected, "Restored vault differs from archive")
        replace_directory(staging, output_dir, "vault")
        require({m["name"]: m for m in inspect_vault(output_dir)} == expected,
                "Restored output verification failed")
        return {"members": len(restored), "ciphertextFiles": len(restored) - 1,
                "parts": len(manifest["parts"]), "restoredBytes": sum(m["size"] for m in restored),
                "verified": True}
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    pack_parser = commands.add_parser("pack", help="Archive the fixed public encrypted vault")
    pack_parser.add_argument("--archive-dir", type=Path, default=ARCHIVE)
    unpack_parser = commands.add_parser("unpack", help="Validate and restore the encrypted vault")
    unpack_parser.add_argument("--archive-dir", type=Path, default=ARCHIVE)
    unpack_parser.add_argument("--output-dir", type=Path, default=VAULT)
    args = parser.parse_args()
    try:
        result = (pack(args.archive_dir.absolute()) if args.command == "pack"
                  else unpack(args.archive_dir.absolute(), args.output_dir.absolute()))
        print(json.dumps(result))
    except (ValueError, OSError, tarfile.TarError, json.JSONDecodeError) as error:
        parser.exit(1, f"Vault archive failed: {error}\n")


if __name__ == "__main__":
    main()
