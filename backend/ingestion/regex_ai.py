"""The AI regex helper: a small language model suggests a regex for one column, Lumina checks and tests it.

Privacy: only the column name, the table name, how many values are filled, the shapes of the values (capital
letters become A, small letters a, digits 9, so "ABCDE1234F" is sent as "AAAAA9999A") and, for columns with only a
few different values that are not identity numbers, those values (like "Office", "Home"). Never a real value.

The model runs at a hosted, OpenAI-compatible API (by default Groq's free tier). LLM_API_KEY, LLM_BASE_URL and
LLM_MODEL come from the environment; without a key the helper is simply off. A suggestion is never applied on its
own: the screen shows it with how many rows pass, and the person previews and applies it as usual.
"""

import json
import logging
import re
import urllib.error
import urllib.request
from collections import Counter

from django.conf import settings

from .raw import is_identity
from .rules import RuleError, compile_rule, preview, rows_of, text_of

log = logging.getLogger(__name__)

MOST_SHAPES = 8
TIMEOUT = 25  # seconds for one answer from the model

SYSTEM = (
    "You write one regular expression that checks the values of one column in a bank's data table. "
    'Reply with JSON only, exactly like {"pattern": "...", "explanation": "...", "valid_examples": ["...", "..."], '
    '"invalid_examples": [{"value": "...", "why": "..."}, {"value": "...", "why": "..."}]}. '
    "The pattern must describe the correct format, so wrong values in the column fail it. It must match the whole "
    "value, start with ^ and end with $, and use Python regex syntax. The explanation is one short sentence in plain "
    "English for someone who does not know regex. Give 2 made-up values that match and 2 made-up values that do not, "
    "each with a few words on why it fails; never copy real data. In the shapes you are given, A is a capital letter, a "
    "is a small letter and 9 is a digit; every other character is itself."
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


def _ask(messages, json_mode=True):
    """The model's answer to a conversation, as text. If JSON mode is refused (HTTP 400), asks once more without
    it; _read pulls the JSON out of plain text too."""
    payload = {"model": settings.LLM_MODEL, "messages": messages, "temperature": 0.1}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    body = json.dumps(payload).encode()
    request = urllib.request.Request(
        settings.LLM_BASE_URL.rstrip("/") + "/chat/completions", data=body, method="POST",
        headers={"Authorization": f"Bearer {settings.LLM_API_KEY.strip()}", "Content-Type": "application/json",
                 "User-Agent": "Lumina-CRI"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.loads(response.read())["choices"][0]["message"]["content"]
    except urllib.error.HTTPError as exc:
        raw = exc.read()[:20000].decode("utf-8", "replace")
        detail = raw[:300]
        log.warning("AI helper: HTTP %s from the model API: %s", exc.code, detail)
        if exc.code == 400 and "json_validate_failed" in raw:
            # JSON mode refused the answer, usually for a regex backslash like \d that is not a JSON escape.
            # The provider sends the answer back anyway; _read repairs it.
            try:
                failed = json.loads(raw).get("error", {}).get("failed_generation")
            except ValueError:
                failed = None
            if failed:
                return failed
        if exc.code == 400 and json_mode and "model" not in detail.lower():
            return _ask(messages, json_mode=False)
        if exc.code == 429:
            raise AiError("The AI helper is busy. Please try again in a minute.") from exc
        if exc.code == 401:
            raise AiError("The AI key is not accepted (HTTP 401). Check LLM_API_KEY on the server.") from exc
        if exc.code in (400, 404) and "model" in detail.lower():
            raise AiError(f"The AI model {settings.LLM_MODEL!r} is not available (HTTP {exc.code}). "
                          "Set LLM_MODEL on the server to a model the provider lists.") from exc
        raise AiError(f"The AI helper did not answer (HTTP {exc.code}). Please try again, or pick from the "
                      "library.") from exc
    except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as exc:
        log.warning("AI helper: no answer from the model API: %r", exc)
        raise AiError("The AI helper did not answer (no connection). Please try again, or pick from the "
                      "library.") from exc


def _read(answer):
    """The model's JSON answer as a dict ({} when it is not JSON)."""
    found = re.search(r"\{.*\}", answer or "", re.S)
    data = {}
    if found:
        text = found.group()
        try:
            data = json.loads(text)
        except ValueError:
            # A regex written straight into JSON: \d, \s, \+ are not JSON escapes. Double every backslash that
            # does not start a proper escape and try again.
            try:
                data = json.loads(re.sub(r"\\(.)", lambda m: m.group(0) if m.group(1) in '\\"/bfnrtu'
                                         else "\\\\" + m.group(1), text, flags=re.S))
            except ValueError:
                data = {}
    return data if isinstance(data, dict) else {}


def examples(compiled, data):
    """(matching, failing) made-up examples, sorted by what the regex really does, not by what the model said:
    a small model sometimes puts an example on the wrong side. failing: [{value, why}]."""
    offered = [(str(v), "") for v in data.get("valid_examples") or [] if isinstance(v, (str, int))]
    for item in data.get("invalid_examples") or []:
        if isinstance(item, dict):
            offered.append((str(item.get("value", "")), str(item.get("why", "")).strip()))
        elif isinstance(item, (str, int)):
            offered.append((str(item), ""))
    matching, failing = [], []
    for value, why in offered[:8]:
        if compiled.fullmatch(value):
            matching.append(value)
        else:
            failing.append({"value": value, "why": why})
    return matching[:3], failing[:3]


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
        data = _read(answer)
        pattern, explanation = str(data.get("pattern") or "").strip(), str(data.get("explanation") or "").strip()
        try:
            tested = preview(table, column, pattern)
        except RuleError as exc:
            messages += [{"role": "assistant", "content": answer},
                         {"role": "user", "content": f"That pattern does not work: {exc} Reply again with JSON."}]
            continue
        matching, failing = examples(compile_rule(pattern), data)
        return {"pattern": pattern, "explanation": explanation, "matching": matching, "failing": failing,
                "passed": tested["passed"], "failed": tested["failed"], "total": tested["total"]}
    raise AiError("The AI could not write a working regex for this column. Try describing the rule in words.")


# ---------- Free-form generator (the Lumina AI chat panel) ----------
# No table or column is picked: the person describes any format in words ("+91 Indian mobile", "office address",
# "PAN") and gets a checked regex. Nothing from the data is sent, only the request and the chat so far.

MAX_TURNS = 6  # earlier chat turns sent along, so "make +91 optional" can refine the last answer
MAX_WISH = 500

GENERATE_SYSTEM = (
    "You are Lumina AI, a regex assistant inside an Indian bank's customer data platform. The person describes a "
    "value format in words and you write one regular expression for it. The data holds Indian customer records; "
    "fields include: customer ID / CIF, name, father's name, date of birth, gender, PAN, Aadhaar, CKYC number, "
    "passport, voter ID, driving licence, mobile (Indian, may have +91 / 91 / 0 in front), landline, email, "
    "address lines (home, office, permanent, correspondence), city, state, PIN code (6 digits, not starting with 0), "
    "country, IFSC, account number, GSTIN, UPI ID, occupation, income, residency, dates, timestamps and amounts. "
    "Use Indian formats unless the person asks for another country: a mobile number is 10 digits starting 6-9, "
    "PAN is 5 capitals, 4 digits, 1 capital, Aadhaar is 12 digits not starting 0 or 1, PIN code is 6 digits not "
    "starting 0, IFSC is 4 capitals, 0, then 6 letters or digits. Be generous with real-world variation (spaces, "
    "dashes, case) only when the person asks for it or when the format clearly allows it.\n"
    'Reply with JSON only, exactly like {"pattern": "...", "explanation": "...", "valid_examples": ["...", "..."], '
    '"invalid_examples": [{"value": "...", "why": "..."}, {"value": "...", "why": "..."}]}. '
    "The pattern must match the whole value, start with ^ and end with $, and use Python regex syntax (no inline "
    "flags in the middle). The explanation is one or two short sentences in plain English for someone who does not "
    "know regex. Give 2 or 3 made-up values that match and 2 or 3 that do not, each with a few words on why it "
    "fails. If the request is not about a value format, set pattern to \"\" and put a short helpful reply in "
    "explanation."
)


def _history(history):
    """The earlier chat turns, cleaned: [{role, content}], newest last, at most MAX_TURNS."""
    turns = []
    for item in (history or [])[-MAX_TURNS:]:
        if not isinstance(item, dict) or item.get("role") not in ("user", "assistant"):
            continue
        text = str(item.get("text") or "").strip()[:MAX_WISH]
        if item.get("regex"):
            text = f"{text}\nRegex: {str(item['regex'])[:300]}"
        if text:
            turns.append({"role": item["role"], "content": text})
    return turns


def generate(wish, history=None):
    """A checked regex for a format described in words: {pattern, explanation, matching, failing}. pattern is ""
    when the request was not about a format (the explanation then is the reply). Asks again once if the regex does
    not compile."""
    wish = (wish or "").strip()[:MAX_WISH]
    if not wish:
        raise AiError("Describe the value format you need.")
    if not settings.LLM_API_KEY:
        raise AiError("The AI helper is not set up yet. Pick a regex from the library meanwhile.")
    messages = [{"role": "system", "content": GENERATE_SYSTEM}, *_history(history), {"role": "user", "content": wish}]
    for _ in range(2):
        answer = _ask(messages)
        data = _read(answer)
        pattern, explanation = str(data.get("pattern") or "").strip(), str(data.get("explanation") or "").strip()
        if not pattern:
            if explanation:
                return {"pattern": "", "explanation": explanation, "matching": [], "failing": []}
            messages += [{"role": "assistant", "content": answer},
                         {"role": "user", "content": "Reply again with the JSON described, with a pattern."}]
            continue
        try:
            compiled = compile_rule(pattern)
        except RuleError as exc:
            messages += [{"role": "assistant", "content": answer},
                         {"role": "user", "content": f"That pattern does not work: {exc} Reply again with JSON."}]
            continue
        matching, failing = examples(compiled, data)
        return {"pattern": pattern, "explanation": explanation, "matching": matching, "failing": failing}
    raise AiError("The AI could not write a working regex for that. Try describing the format another way.")
