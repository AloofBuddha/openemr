from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class OtherExtraction(BaseModel):
    """Fallback extraction for documents that aren't lab PDFs or intake forms.

    Used when:
      - doc_type is explicitly "other"
      - filename/content-based detection can't classify the document
      - extraction of a known type fails unexpectedly (graceful degradation)
    """

    doc_type: Literal["other"]
    patient_id: int
    openemr_doc_id: int
    detected_type: str | None = None      # best-guess label, e.g. "referral letter"
    summary: str | None = None            # one-sentence description of the document
    extraction_warnings: list[str] = []
