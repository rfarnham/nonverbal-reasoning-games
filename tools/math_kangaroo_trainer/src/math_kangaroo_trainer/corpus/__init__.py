"""Read-only corpus ingestion and deterministic Stage 0 audit logic."""

from .source_adapter import CompleteBankAdapter, SourceSchemaError

__all__ = ["CompleteBankAdapter", "SourceSchemaError"]
