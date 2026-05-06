"""Pydantic models for the FastAPI sidecar surface.

These define the wire format between the PHP module and the Python sidecar.
Pydantic enforces shape + types; the endpoints stay thin.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

DocType = Literal["lab_pdf", "intake_form"]
SupportedMimetype = Literal["application/pdf", "image/png", "image/jpeg"]

# Caps reflect what the UI can realistically generate. Anything past these
# is treated as malformed and rejected with 422.
_MAX_QUERY_CHARS = 500
_MAX_PATIENT_CONTEXT_CHARS = 16_000


class IngestRequest(BaseModel):
    patient_id: int
    openemr_doc_id: int
    doc_type: DocType
    file_bytes_b64: str  # base64-encoded file bytes
    mimetype: SupportedMimetype


class QueryRequest(BaseModel):
    patient_id: int
    query: str = Field(min_length=1, max_length=_MAX_QUERY_CHARS)
    patient_context: str = Field(max_length=_MAX_PATIENT_CONTEXT_CHARS)
    doc_ids: list[int] = []
