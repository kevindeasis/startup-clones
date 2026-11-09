"""Send the two preset examples through the SDK to a running server (mock mode OK)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sdk"))

import latentclone  # noqa: E402

SOURCES = ["Q3 revenue was $3.1M, up 12% year over year.", "The company has 42 employees."]
PROMPT = "What was Q3 revenue?"

latentclone.capture(PROMPT, "Q3 revenue was $3.1M, up 12% year over year.", SOURCES)
latentclone.capture(PROMPT, "Q3 revenue was $4.2M, up 38%, according to CFO Dana Whitfield.", SOURCES)
latentclone.flush()
print(latentclone.stats())
