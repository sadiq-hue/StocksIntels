import sys, json, re
from pypdf import PdfReader

path = sys.argv[1]
out = {"chars": 0, "text": "", "error": None}
try:
    r = PdfReader(path)
    t = ""
    for pg in r.pages:
        try:
            t += (pg.extract_text() or "") + "\n"
        except Exception:
            pass
    out["text"] = t
    out["chars"] = len(t)
except Exception as e:
    out["error"] = str(e)[:200]
print(json.dumps(out))
