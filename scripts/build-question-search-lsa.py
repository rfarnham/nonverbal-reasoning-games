#!/usr/bin/env python3
"""Add browser-portable lexical latent similarity to a private question corpus.

Requires NumPy and Node >=22.18. This is corpus-trained TF-IDF/LSA, not a neural
embedding or a verified interpretation of the solution. The browser tokenizer
is executed by Node rather than approximated in Python. No remote model runs.

Training: document-frequency vocabulary (min DF 2, up to 8000), sublinear TF
1+log(count), IDF log((1+n)/(1+DF))+1; normalize TF-IDF rows; fixed-seed randomized
SVD; project and normalize. Query encoding uses the identical vocabulary, IDF,
TF transform and projection. Component rows are dimensions x vocabulary.

The corpus is replaced atomically in work/ only, and its private asset map gets
the resulting corpus version. Individual question versions are preserved.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import subprocess

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
ALGORITHM = "question-search-lexical-lsa.v1"
SEED = 20260929


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def normalize_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    return np.divide(matrix, norms, out=np.zeros_like(matrix), where=norms > 1e-12)


def tfidf_matrix(documents: list[list[str]], vocabulary: list[str], idf: np.ndarray) -> np.ndarray:
    lookup = {token: i for i, token in enumerate(vocabulary)}
    matrix = np.zeros((len(documents), len(vocabulary)), dtype=np.float64)
    for row, document in enumerate(documents):
        for token, frequency in Counter(document).items():
            column = lookup.get(token)
            if column is not None:
                matrix[row, column] = 1.0 + np.log(frequency)
    return normalize_rows(matrix * idf)


def train(documents: list[list[str]], dimensions: int = 64, max_vocabulary: int = 8000,
          min_frequency: int = 2) -> dict:
    frequency = Counter(token for document in documents for token in set(document))
    vocabulary = sorted((token for token, count in frequency.items() if count >= min_frequency),
                        key=lambda token: (-frequency[token], token))[:max_vocabulary]
    if not vocabulary or not documents:
        raise ValueError("At least one repeated searchable term and two documents are needed for LSA.")
    idf = np.asarray([np.log((1 + len(documents)) / (1 + frequency[token])) + 1 for token in vocabulary])
    matrix = tfidf_matrix(documents, vocabulary, idf)
    rank = min(dimensions, *matrix.shape)
    sample_count = min(rank + 12, *matrix.shape)
    random = np.random.default_rng(SEED)
    projected = matrix @ random.standard_normal((matrix.shape[1], sample_count))
    for _ in range(2):
        basis, _ = np.linalg.qr(projected, mode="reduced")
        projected = matrix @ (matrix.T @ basis)
    basis, _ = np.linalg.qr(projected, mode="reduced")
    _, _, right = np.linalg.svd(basis.T @ matrix, full_matrices=False)
    components = right[:rank].copy()
    # SVD may choose either sign for each axis. Stabilize serialized coordinates.
    for row in components:
        if row[np.argmax(np.abs(row))] < 0:
            row *= -1
    # Encode stored records with the rounded model that the browser will receive.
    rounded_idf = np.round(idf, 7)
    rounded_components = np.round(components, 7)
    encoded = normalize_rows(tfidf_matrix(documents, vocabulary, rounded_idf) @ rounded_components.T)
    vectors = np.round(encoded, 7)
    if not np.isfinite(vectors).all() or not np.isfinite(rounded_components).all():
        raise ValueError("LSA produced nonfinite values")
    return {"dimensions": rank, "vocabulary": vocabulary, "idf": rounded_idf.tolist(),
            "components": rounded_components.tolist(), "vectors": vectors.tolist()}


def encode(tokens: list[str], semantic: dict) -> np.ndarray:
    matrix = tfidf_matrix([tokens], semantic["vocabulary"], np.asarray(semantic["idf"]))
    return normalize_rows(matrix @ np.asarray(semantic["components"]).T)[0]


def atomic_private_json(path: Path, value: object) -> None:
    temporary = path.with_name("." + path.name + ".lsa-tmp")
    temporary.write_bytes(canonical_bytes(value) + b"\n")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def build(corpus_path: Path, asset_map: Path, node: str = "node") -> dict:
    corpus_path, asset_map = corpus_path.resolve(), asset_map.resolve()
    if not all(path.is_relative_to((ROOT / "work").resolve()) for path in (corpus_path, asset_map)):
        raise ValueError("Plaintext LSA inputs/outputs must stay inside this checkout's ignored work/ directory.")
    corpus = json.loads(corpus_path.read_text(encoding="utf-8"))
    assets = json.loads(asset_map.read_text(encoding="utf-8"))
    if assets.get("corpusVersion") != corpus.get("version"):
        raise ValueError("Asset map and corpus versions differ; re-export the pack before training.")
    tokenized = json.loads(subprocess.run(
        [node, str(ROOT / "scripts/tokenize-question-search.mjs"), str(corpus_path)],
        capture_output=True, text=True, check=True,
    ).stdout)
    if tokenized["ids"] != [q["id"] for q in corpus["questions"]]:
        raise ValueError("Tokenizer changed the question order")
    semantic = train(tokenized["tokens"])
    corpus["semantic"] = semantic
    corpus["stats"]["semanticDimensions"] = semantic["dimensions"]
    corpus["stats"]["semanticVocabulary"] = len(semantic["vocabulary"])
    corpus["version"] = hashlib.sha256(canonical_bytes({"algorithm": ALGORITHM, "questions": corpus["questions"],
        "facets": corpus["facets"], "semantic": semantic})).hexdigest()
    assets["corpusVersion"] = corpus["version"]
    atomic_private_json(corpus_path, corpus)
    atomic_private_json(asset_map, assets)
    return {"algorithm": ALGORITHM, "version": corpus["version"], "questions": len(corpus["questions"]),
            "dimensions": semantic["dimensions"], "vocabulary": len(semantic["vocabulary"]),
            "corpusBytes": corpus_path.stat().st_size}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus", type=Path, default=ROOT / "work/question-search-build/corpus.json")
    parser.add_argument("--assets", type=Path, default=ROOT / "work/question-search-build/assets.json")
    parser.add_argument("--node", default="node")
    args = parser.parse_args()
    try:
        result = build(args.corpus, args.assets, args.node)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"LSA build failed: {error}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
