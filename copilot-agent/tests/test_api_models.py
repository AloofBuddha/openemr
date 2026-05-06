"""Tests for api_models — the FastAPI request validation layer."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from api_models import IngestRequest, QueryRequest


# ---------------------------------------------------------------------------
# IngestRequest
# ---------------------------------------------------------------------------


def test_ingest_request_accepts_valid_input() -> None:
    req = IngestRequest(
        patient_id=1,
        openemr_doc_id=2,
        doc_type="lab_pdf",
        file_bytes_b64="aGVsbG8=",
        mimetype="application/pdf",
    )
    assert req.doc_type == "lab_pdf"


def test_ingest_request_rejects_unknown_doc_type() -> None:
    """Wire format only allows two doc types — anything else is 422 from Pydantic."""
    with pytest.raises(ValidationError):
        IngestRequest(
            patient_id=1,
            openemr_doc_id=2,
            doc_type="referral_letter",  # type: ignore[arg-type]
            file_bytes_b64="aGVsbG8=",
            mimetype="application/pdf",
        )


def test_ingest_request_rejects_unsupported_mimetype() -> None:
    with pytest.raises(ValidationError):
        IngestRequest(
            patient_id=1,
            openemr_doc_id=2,
            doc_type="lab_pdf",
            file_bytes_b64="aGVsbG8=",
            mimetype="text/html",  # type: ignore[arg-type]
        )


# ---------------------------------------------------------------------------
# QueryRequest
# ---------------------------------------------------------------------------


def test_query_request_rejects_empty_query() -> None:
    with pytest.raises(ValidationError):
        QueryRequest(patient_id=1, query="", patient_context="ctx")


def test_query_request_rejects_overlong_query() -> None:
    with pytest.raises(ValidationError):
        QueryRequest(patient_id=1, query="x" * 501, patient_context="ctx")


def test_query_request_accepts_500_char_query() -> None:
    """500 chars is exactly the limit — must succeed."""
    QueryRequest(patient_id=1, query="x" * 500, patient_context="ctx")


def test_query_request_rejects_overlong_patient_context() -> None:
    with pytest.raises(ValidationError):
        QueryRequest(patient_id=1, query="hi", patient_context="x" * 16_001)


def test_query_request_doc_ids_default_empty() -> None:
    req = QueryRequest(patient_id=1, query="hi", patient_context="ctx")
    assert req.doc_ids == []
