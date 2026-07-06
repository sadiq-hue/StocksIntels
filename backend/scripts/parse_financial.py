"""
NSE Financial Statement Parser
Extracts key financial metrics from NSE annual report PDFs using regex.
Optional GPT-4o-mini fallback when regex yields < 2 key metrics.
Usage:
  python parse_financial.py --docId 123 --path /path/to/pdf --webhook https://...
  python parse_financial.py --docId 123 --path /path/to/pdf --webhook https://... --apiKey sk-... --model gpt-4o-mini
"""

import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error

WEBHOOK_TIMEOUT = 30


def extract_text_from_pdf(path: str) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
    except ImportError:
        print("ERROR:pypdf not installed", flush=True)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR:Failed to open PDF: {e}", flush=True)
        sys.exit(1)

    pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text()
        if text:
            pages.append(text)
    return "\n".join(pages)


METRIC_PATTERNS: dict[str, list[re.Pattern]] = {
    "total_revenue": [
        re.compile(r"(?:total\s+)?revenue[:\s]*([\d,.]+)", re.I),
        re.compile(r"(?:total\s+)?(?:operating\s+)?income[:\s]*([\d,.]+)", re.I),
        re.compile(r"gross\s+revenue[:\s]*([\d,.]+)", re.I),
    ],
    "net_income": [
        re.compile(r"(?:net\s+)?(?:profit|income|earnings)(?:\s+for\s+the\s+(?:period|year))?[:\s]*([\d,.]+)", re.I),
        re.compile(r"(?:profit|loss)\s+for\s+the\s+(?:period|year)[:\s]*([\d,.]+)", re.I),
        re.compile(r"total\s+comprehensive\s+income[:\s]*([\d,.]+)", re.I),
    ],
    "cost_of_revenue": [
        re.compile(r"(?:cost\s+of\s+)?(?:revenue|sales|goods\s+sold)[:\s]*([\d,.]+)", re.I),
        re.compile(r"cost\s+of\s+sales[:\s]*([\d,.]+)", re.I),
    ],
    "operating_income": [
        re.compile(r"operating\s+(?:income|profit)[:\s]*([\d,.]+)", re.I),
        re.compile(r"(?:income|profit)\s+from\s+operations[:\s]*([\d,.]+)", re.I),
    ],
    "cash_from_operations": [
        re.compile(r"(?:net\s+)?cash\s+(?:from|generated\s+by|provided\s+by)\s+operating\s+activities[:\s]*([\d,.]+)", re.I),
        re.compile(r"(?:net\s+)?cash\s+(?:from|from\s+)?operations[:\s]*([\d,.]+)", re.I),
        re.compile(r"operating\s+cash\s+flow[:\s]*([\d,.]+)", re.I),
    ],
    "total_assets": [
        re.compile(r"(?:total\s+)?assets[:\s]*([\d,.]+)", re.I),
    ],
    "total_liabilities": [
        re.compile(r"(?:total\s+)?liabilities[:\s]*([\d,.]+)", re.I),
        re.compile(r"total\s+(?:equity\s+and\s+)?liabilities[:\s]*([\d,.]+)", re.I),
    ],
    "total_debt": [
        re.compile(r"(?:total\s+)?(?:debt|borrowings|loans\s+(?:and|&)\s+borrowings)[:\s]*([\d,.]+)", re.I),
        re.compile(r"total\s+(?:non-current\s+)?(?:liabilities|debt)[:\s]*([\d,.]+)", re.I),
    ],
    "current_assets": [
        re.compile(r"(?:total\s+)?current\s+assets[:\s]*([\d,.]+)", re.I),
    ],
    "current_liabilities": [
        re.compile(r"(?:total\s+)?current\s+liabilities[:\s]*([\d,.]+)", re.I),
    ],
    "shareholders_equity": [
        re.compile(r"(?:shareholders[''´`]?\s*)?equity[:\s]*([\d,.]+)", re.I),
        re.compile(r"(?:total\s+)?equity[:\s]*([\d,.]+)", re.I),
        re.compile(r"net\s+assets[:\s]*([\d,.]+)", re.I),
    ],
    "retained_earnings": [
        re.compile(r"(?:retained\s+)?earnings[:\s]*([\d,.]+)", re.I),
        re.compile(r"retained\s+(?:profit|earnings)[:\s]*([\d,.]+)", re.I),
    ],
    "eps": [
        re.compile(r"(?:earnings\s+per\s+share|eps)[:\s]*([\d,.]+)", re.I),
    ],
    "dividend_per_share": [
        re.compile(r"(?:dividend\s+per\s+share|dps)[:\s]*([\d,.]+)", re.I),
    ],
}


def parse_number(s: str) -> float | None:
    s = s.strip().replace(",", "")
    if s.endswith("%"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def extract_metrics(text: str) -> dict:
    results: dict[str, list[float]] = {}
    for metric, patterns in METRIC_PATTERNS.items():
        values = []
        for p in patterns:
            for match in p.finditer(text):
                val = parse_number(match.group(1))
                if val is not None:
                    values.append(val)
        if values:
            results[metric] = sorted(set(values))[:3]
    return results


KEY_METRICS = {"total_revenue", "net_income", "total_assets", "shareholders_equity", "operating_income", "cash_from_operations"}


def count_key_metrics(metrics: dict) -> int:
    return sum(1 for k in KEY_METRICS if k in metrics)


def call_llm(text: str, api_key: str, model: str = "gpt-4o-mini") -> dict | None:
    prompt = f"""Extract the following financial metrics from this annual report text.
Return ONLY a valid JSON object with these numeric fields (use null if not found):
{{
  "total_revenue": number | null,
  "net_income": number | null,
  "cost_of_revenue": number | null,
  "operating_income": number | null,
  "cash_from_operations": number | null,
  "total_assets": number | null,
  "total_liabilities": number | null,
  "total_debt": number | null,
  "current_assets": number | null,
  "current_liabilities": number | null,
  "shareholders_equity": number | null,
  "retained_earnings": number | null,
  "eps": number | null,
  "dividend_per_share": number | null
}}

Report text:
{text[:8000]}
"""

    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }).encode()

    req = urllib.request.Request(
        os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1") + "/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode())
        content = body["choices"][0]["message"]["content"]
        return json.loads(content)
    except Exception as e:
        print(f"WARNING:LLM call failed: {e}", flush=True)
        return None


def send_webhook(url: str, data: dict) -> None:
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=WEBHOOK_TIMEOUT)
        print(f"WEBHOOK:Sent to {url}", flush=True)
    except Exception as e:
        print(f"WARNING:Webhook failed: {e}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Parse NSE financial statement PDF")
    parser.add_argument("--docId", required=True, help="Financial statement ID")
    parser.add_argument("--path", required=True, help="Path to PDF file")
    parser.add_argument("--webhook", required=True, help="Webhook URL to POST results")
    parser.add_argument("--apiKey", help="OpenAI API key for LLM fallback")
    parser.add_argument("--model", default="gpt-4o-mini", help="LLM model name")
    args = parser.parse_args()

    print(f"START:docId={args.docId} path={args.path}", flush=True)

    text = extract_text_from_pdf(args.path)
    if not text.strip():
        send_webhook(args.webhook, {
            "docId": args.docId,
            "status": "failed",
            "error": "No text could be extracted from PDF",
        })
        sys.exit(0)

    metrics = extract_metrics(text)
    key_count = count_key_metrics(metrics)

    if key_count < 2 and args.apiKey:
        print(f"INFO:Only {key_count} key metrics found via regex, trying LLM fallback", flush=True)
        llm_result = call_llm(text, args.apiKey, args.model)
        if llm_result and any(v is not None for v in llm_result.values()):
            metrics = {k: [v] if v is not None else [] for k, v in llm_result.items()}
            processed_by = f"llm:{args.model}"
        else:
            processed_by = "regex"
    else:
        processed_by = "regex"

    parsed_data = {}
    for metric, values in metrics.items():
        if values:
            best = min(values, key=lambda x: abs(x))
            parsed_data[metric] = round(best, 2) if best else None

    print(f"RESULT:{json.dumps(parsed_data)}", flush=True)
    print(f"PROCESSED_BY:{processed_by}", flush=True)

    send_webhook(args.webhook, {
        "docId": args.docId,
        "status": "completed",
        "parsedData": parsed_data,
        "processedBy": processed_by,
    })

    print("DONE", flush=True)


if __name__ == "__main__":
    main()
