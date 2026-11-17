"""Prompts for the live (Anthropic) pipeline."""

SYSTEM = (
    "You are a medical-records analyst for medico-legal review. You read pages of medical records and produce "
    "structured, source-cited output for a physician expert witness. Never infer facts that are not on the page. "
    "Every event must cite the page marker it came from (e.g. CHR-000012). Quotes must be verbatim from the page. "
    "Return JSON only: no prose, no markdown fences."
)

CLASSIFY_SCHEMA = """Return a JSON array, one object per input page, in the same order:
[{"key": "<page key as given>", "doc_type": "ED triage note|admission H&P|operative report|nursing notes|discharge summary|radiology report|lab results|pharmacy MAR|physio note|GP letter|other",
  "facility": "string or null", "provider": "string or null", "service_date": "YYYY-MM-DD or null",
  "page_role": "first|continuation", "confidence": 0.0-1.0}]
A page is "continuation" if it continues a document begun on an earlier page (e.g. "(continued)", "Page 2 of 3")."""

CLASSIFY_EXAMPLE = """Example output for one page:
[{"key":"p17","doc_type":"operative report","facility":"St. Mary's Regional Medical Center","provider":"Dr. R. Okafor","service_date":"2024-03-16","page_role":"first","confidence":0.95}]"""

EVENT_SCHEMA = """Extract the clinical events from the pages below. Return a JSON array of objects:
{"date": "YYYY-MM-DD", "time": "HH:MM or null", "facility": "string", "provider": "string or null",
 "category": "visit|imaging|lab|medication|procedure|diagnosis|nursing|discharge|correspondence|other",
 "summary": "at most 2 sentences", "significance": "low|medium|high",
 "source_pages": ["CHR-000012"], "quote": "verbatim text from the page, at most 200 characters"}
Pages are delimited by markers such as [[PAGE CHR-000012]]. source_pages must only contain markers present in the input."""

EVENT_EXAMPLE = """Example:
[{"date":"2024-03-16","time":"08:05","facility":"St. Mary's Regional Medical Center","provider":"Dr. R. Okafor",
  "category":"procedure","summary":"Right hip hemiarthroplasty performed under spinal anaesthesia for displaced femoral neck fracture.",
  "significance":"high","source_pages":["CHR-000012"],"quote":"Right hip hemiarthroplasty was performed on 2024-03-16 under spinal anaesthesia"}]"""

CONFLICT_SCHEMA = """Below is a chronologically sorted list of events with ids. Identify contradictions between events
(e.g. different dates for the same surgery, conflicting allergy information, inconsistent doses). Return JSON:
{"conflicts": [{"event_ids": [1, 2], "description": "what contradicts what"}]}  (empty list if none)"""
