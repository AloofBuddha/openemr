from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


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
