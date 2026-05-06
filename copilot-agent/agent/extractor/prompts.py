"""Prompt templates for document extraction.

Two pairs (text + vision) for two document types (lab + intake). The text
prompts use ``{text}`` as a single placeholder; vision prompts have no
placeholders since the image is supplied alongside.

For intake, both prompts ask Claude to emit a ``source_quote`` per
medication/allergy so downstream code can build a per-entry SourceCitation.
"""
from __future__ import annotations


LAB_TEXT_PROMPT = """\
You are a clinical data extraction assistant. Extract all lab test results from the text below.

Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{{
  "results": [
    {{
      "test_name": "string",
      "value": "string",
      "unit": "string or null",
      "reference_range": "string or null",
      "collection_date": "YYYY-MM-DD or null",
      "abnormal_flag": "H | L | C | N | null",
      "confidence": 0.95
    }}
  ],
  "extraction_warnings": ["string"]
}}

Rules:
- confidence is a float in [0, 1] reflecting how clearly the value was printed
- abnormal_flag: H=high, L=low, C=critical, N=normal; null if not stated
- If a field is not present in the source, use null
- Add a warning string for any value that was ambiguous or partially illegible

Lab report text:
{text}
"""


LAB_VISION_PROMPT = """\
You are a clinical data extraction assistant. Extract all lab test results visible in this image.

Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{
  "results": [
    {
      "test_name": "string",
      "value": "string",
      "unit": "string or null",
      "reference_range": "string or null",
      "collection_date": "YYYY-MM-DD or null",
      "abnormal_flag": "H | L | C | N | null",
      "confidence": 0.95
    }
  ],
  "extraction_warnings": ["string"]
}

Rules:
- confidence is a float in [0, 1] reflecting how clearly the value was printed
- abnormal_flag: H=high, L=low, C=critical, N=normal; null if not stated
- If a field is not present in the source, use null
- Add a warning string for any value that was ambiguous or partially illegible
"""


INTAKE_TEXT_PROMPT = """\
You are a clinical data extraction assistant. Extract structured information from this patient intake form.

Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{{
  "demographics": {{
    "name": "string or null",
    "dob": "string or null",
    "sex": "string or null",
    "address": "string or null",
    "phone": "string or null"
  }},
  "chief_concern": "string or null",
  "vitals": {{
    "blood_pressure": "string or null (e.g. '120/80')",
    "heart_rate": "string or null (e.g. '72 bpm')",
    "weight": "string or null (e.g. '165 lbs')",
    "height": "string or null (e.g. \"5'6\\\"\")",
    "bmi": "string or null",
    "temperature": "string or null",
    "oxygen_saturation": "string or null"
  }},
  "current_medications": [
    {{
      "name": "string",
      "dose": "string or null",
      "frequency": "string or null",
      "confidence": 0.9,
      "source_quote": "string — the exact phrase from the form for this medication"
    }}
  ],
  "allergies": [
    {{
      "allergen": "string",
      "reaction": "string or null",
      "confidence": 0.9,
      "source_quote": "string — the exact phrase from the form for this allergy"
    }}
  ],
  "past_medical_history": ["string — e.g. 'Type 2 diabetes mellitus', 'Hypertension'"],
  "surgical_history": ["string — e.g. 'Appendectomy 2005', 'C-section 2010'"],
  "social_history": {{
    "tobacco": "string or null — e.g. 'Non-smoker' or 'Smokes 1 ppd x 10 years'",
    "alcohol": "string or null — e.g. 'Occasional, 1-2 drinks/week'",
    "exercise": "string or null — e.g. 'Walks 30 min 3x/week'",
    "occupation": "string or null"
  }},
  "family_history": ["string — e.g. 'Father: MI at 61', 'Mother: T2DM'"],
  "extraction_warnings": ["string"]
}}

Rules:
- confidence is a float in [0, 1] for each medication/allergy entry
- source_quote is the verbatim phrase from the form that this entry came from (used for citation tracking)
- Use null for any field not clearly stated in the form
- vitals: extract any vital signs listed on the form; use null for absent fields
- past_medical_history: list every chronic condition, diagnosis, or health problem reported
- surgical_history: list every surgery or major procedure reported with year if available
- social_history: summarise each category in a short phrase; null if not mentioned
- family_history is a list of plain strings (e.g. "Father: hypertension")
- Add extraction_warnings for any field that was ambiguous or illegible

Intake form text:
{text}
"""


INTAKE_VISION_PROMPT = """\
You are a clinical data extraction assistant. Extract structured information from this patient intake form image.

Return ONLY valid JSON matching this exact structure — no markdown, no explanation:
{
  "demographics": {
    "name": "string or null",
    "dob": "string or null",
    "sex": "string or null",
    "address": "string or null",
    "phone": "string or null"
  },
  "chief_concern": "string or null",
  "vitals": {
    "blood_pressure": "string or null",
    "heart_rate": "string or null",
    "weight": "string or null",
    "height": "string or null",
    "bmi": "string or null",
    "temperature": "string or null",
    "oxygen_saturation": "string or null"
  },
  "current_medications": [
    {
      "name": "string",
      "dose": "string or null",
      "frequency": "string or null",
      "confidence": 0.9,
      "source_quote": "string — the exact phrase from the form for this medication"
    }
  ],
  "allergies": [
    {
      "allergen": "string",
      "reaction": "string or null",
      "confidence": 0.9,
      "source_quote": "string — the exact phrase from the form for this allergy"
    }
  ],
  "past_medical_history": ["string — e.g. 'Type 2 diabetes mellitus', 'Hypertension'"],
  "surgical_history": ["string — e.g. 'Appendectomy 2005', 'C-section 2010'"],
  "social_history": {
    "tobacco": "string or null",
    "alcohol": "string or null",
    "exercise": "string or null",
    "occupation": "string or null"
  },
  "family_history": ["string — e.g. 'Father: MI at 61', 'Mother: T2DM'"],
  "extraction_warnings": ["string"]
}

Rules:
- confidence is a float in [0, 1] for each medication/allergy entry
- source_quote is the verbatim phrase from the form that this entry came from (used for citation tracking)
- Use null for any field not clearly stated in the form
- vitals: extract any vital signs listed on the form; use null for absent fields
- past_medical_history: list every chronic condition, diagnosis, or health problem reported
- surgical_history: list every surgery or major procedure reported with year if available
- social_history: summarise each category in a short phrase; null if not mentioned
- family_history is a list of plain strings (e.g. "Father: hypertension")
- Add extraction_warnings for any field that was ambiguous or illegible
"""
