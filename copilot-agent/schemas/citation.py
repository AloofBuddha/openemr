from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class BBox(BaseModel):
    """Page-relative bounding box for a verbatim quote.

    Coordinates are PDF-space (origin bottom-left, points). The UI
    converts to canvas coordinates using the rendered page's height.
    """

    page: int          # 1-indexed
    x0: float
    y0: float
    x1: float
    y1: float
    page_width: float  # PDF page width in points
    page_height: float # PDF page height in points


class SourceCitation(BaseModel):
    """Provenance for any claim made by the co-pilot agent.

    Every piece of clinical information returned to the UI must carry a
    citation so the physician can verify against the original record.
    """

    source_type: Literal["lab_pdf", "intake_form", "guideline_chunk", "openemr_record"]
    source_id: str          # document UUID (hex) or OpenEMR record id
    page_or_section: str    # e.g. "page 2" or "Section 4.3"
    field_or_chunk_id: str
    quote_or_value: str     # verbatim text extracted from source
    bbox: BBox | None = None  # optional: pixel/page-coord rectangle for overlay
