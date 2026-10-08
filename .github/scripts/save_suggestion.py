"""Append one suggestion issue to recommendations.md and recommendations.json.

Reads the issue from environment variables set by the workflow. The text comes
from the public, so it is trimmed, stripped of control characters and written
as quoted data, never executed or interpreted.
"""
import json
import os
import re
from pathlib import Path

MAX_FIELD = 4000
FIELDS = {"What kind of suggestion?": "kind", "Activity": "activity", "Place": "place", "Details": "details"}


def clean(text):
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text or "").replace("\r\n", "\n").strip()
    return text[:MAX_FIELD]


def parse(body):
    """Issue forms arrive as '### Label' headings, each followed by the answer."""
    entry = {}
    for label, answer in re.findall(r"^### (.+?)\n+(.*?)(?=^### |\Z)", body, flags=re.S | re.M):
        key = FIELDS.get(label.strip())
        if key:
            answer = clean(answer)
            entry[key] = "" if answer == "_No response_" else answer
    return entry


def main():
    body = clean(os.environ.get("ISSUE_BODY", ""))
    entry = {
        "issue": int(os.environ["ISSUE_NUMBER"]),
        "date": os.environ.get("ISSUE_CREATED", "")[:10],
        "from": clean(os.environ.get("ISSUE_USER", "")),
        "url": os.environ.get("ISSUE_URL", ""),
        "title": clean(os.environ.get("ISSUE_TITLE", ""))[:200],
        **parse(body),
    }
    if "details" not in entry:
        entry["details"] = body  # not from the form: keep whatever was written

    data_file = Path("recommendations.json")
    entries = json.loads(data_file.read_text(encoding="utf-8")) if data_file.exists() else []
    entries.append(entry)
    data_file.write_text(json.dumps(entries, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    notes = Path("recommendations.md")
    if not notes.exists():
        notes.write_text("# Suggestions from the site\n\nNewest at the bottom. Each one links to its GitHub issue.\n", encoding="utf-8")
    quoted = "\n".join("> " + line for line in entry["details"].split("\n"))
    heading = " / ".join(filter(None, [entry.get("kind"), entry.get("activity"), entry.get("place")])) or entry["title"]
    with notes.open("a", encoding="utf-8") as out:
        out.write(f"\n## #{entry['issue']} {heading.replace(chr(10), ' ')}\n\n")
        out.write(f"{entry['date']}, from @{entry['from']} ([issue]({entry['url']}))\n\n{quoted}\n")


if __name__ == "__main__":
    main()
