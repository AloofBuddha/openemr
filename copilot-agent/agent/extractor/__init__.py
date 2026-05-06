"""Document extraction package.

Public entry point: ``extract_document`` — dispatches to lab or intake
extraction, choosing between pdfplumber-text and Claude-vision paths
based on the document mimetype and contents.
"""
from agent.extractor.dispatch import extract_document

__all__ = ["extract_document"]
