"""The AI regex helper: a small language model suggests a regex for one column, Lumina checks and tests it.

Privacy: only the column name, the table name, how many values are filled, the shapes of the values (capital
letters become A, small letters a, digits 9, so "ABCDE1234F" is sent as "AAAAA9999A") and, for columns with only a
few different values that are not identity numbers, those values (like "Office", "Home"). Never a real value.

The model runs at a hosted, OpenAI-compatible API (by default Groq's free tier). LLM_API_KEY, LLM_BASE_URL and
LLM_MODEL come from the environment; without a key the helper is simply off. A suggestion is never applied on its
own: the screen shows it with how many rows pass, and the person previews and applies it as usual.
"""

import json
import re
import urllib.error
import urllib.request
from collections import Counter

from django.conf import settings

from .raw import is_identity
from .rules import RuleError, compile_rule, preview, rows_of, text_of

MOST_SHAPES = 8
TIMEOUT = 25  # seconds for one answer from the model

SYSTEM = (
    "You write one regular expression that checks the values of one column in a bank's data table. "
    'Reply with JSON only, exactly like {"pattern": "...", "explanation": "..."}. '
    "The pattern must describe the correct format, so wrong values in the column fail it. It must match the whole "
    "value, start with ^ and end with $, and use Python regex syntax. The explanation is one short sentence in plain "
    "English for someone who does not know regex. In the shapes you are given, A is a capital letter, a is a small "
    "letter and 9 is a digit; every other character is itself."
)


class AiError(Exception):
    """The helper could not give a suggestion. The message is safe to show on screen."""


def shape(text):
    return re.sub(r"[0-9]", "9", re.sub(r"[a-z]", "a", re.sub(r"[A-Z]", "A", text)))[:40]


def describe(table, column):
    """What the model is told about a column. Shapes and counts only, never the values themselves."""
    i = table.columns.index(column)
    values = [text_of(plain[i]).strip() for _, plain, _ in rows_of(table)]
    filled = [v for v in values if v]
    lines = [f"Table: {table.name}", f"Column: {column}", f"Rows: {len(values)}, empty: {len(values) - len(filled)}"]
    shapes = Counter(shape(v) for v in filled).most_common(MOST_SHAPES)
    if shapes:
        lines.append("Most common value shapes (shape: how many):")
        lines += [f"  {s!r}: {count}" for s, count in shapes]
    profile = next((c for c in (table.profile or {}).get("columns", []) if c["name"] == column), {})
    listed = profile.get("values") or []
    if listed and not is_identity(column):
        lines.append("The column holds only these values: " + ", ".join(repr(v["label"]) for v in listed))
    return "\n".join(lines)


def _ask(messages):
    """The model's answer to a conversation, as text."""
    body = json.dumps({"model": settings.LLM_MODEL, "messages": messages, "temperature": 0.1,
                       "response_format": {"type": "json_object"}}).encode()
    request = urllib.request.Request(
        settings.LLM_BASE_URL.rstrip("/") + "/chat/completions", data=body, method="POST",
        headers={"Authorization": f"Bearer {settings.LLM_API_KEY}", "Content-Type": "application/json",
                 "User-Agent": "Lumina-CRI"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read())["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise AiError("The AI helper is busy. Please try again in a minute.") from exc
        raise AiError("The AI helper did not answer. Please try again, or pick from the library.") from exc
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as exc:
        raise AiError("The AI helper did not answer. Please try again, or pick from the library.") from exc


def _read(answer):
    """(pattern, explanation) from the model's JSON answer."""
    found = re.search(r"\{.*\}", answer or "", re.S)
    try:
        data = json.loads(found.group()) if found else {}
    except ValueError:
        data = {}
    return str(data.get("pattern") or "").strip(), str(data.get("explanation") or "").strip()


def suggest(table, column, wish=""):
    """A checked suggestion for one column: {pattern, explanation, passed, failed, total}. If the first regex is not
    proper, the model is told why and asked once more."""
    if not settings.LLM_API_KEY:
        raise AiError("The AI helper is not set up yet. Pick a regex from the library meanwhile.")
    ask = describe(table, column) + "\n\n" + (
        f"What the user wants: {wish.strip()[:300]}" if wish.strip() else "Suggest the correct format for this column.")
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ask}]
    for attempt in range(2):
        answer = _ask(messages)
        pattern, explanation = _read(answer)
        try:
            tested = preview(table, column, pattern)
        except RuleError as exc:
            messages += [{"role": "assistant", "content": answer},
                         {"role": "user", "content": f"That pattern does not work: {exc} Reply again with JSON."}]
            continue
        return {"pattern": pattern, "explanation": explanation, "passed": tested["passed"],
                "failed": tested["failed"], "total": tested["total"]}
    raise AiError("The AI could not write a working regex for this column. Try describing the rule in words.")
