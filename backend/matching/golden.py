"""The golden record of one person: the best value of each field from all their records, chosen field by field,
with why it was chosen and why every other value was not.

How a value is chosen:
  Name, date of birth, gender, PAN, Aadhaar   source order: the first source in priority order that has it
                                              (source priority follows each source's trust, highest first)
  Mobile, email                               most recent: the record updated last that has it
  Address, city, state, pincode               most recent, and all four from the same record, so an address is
                                              never stitched together from two places
Only clean (silver) values take part: a value failing its column rule never reaches the golden record. When two
records of the same source tie, the one with the higher trust score wins. Each field also says how many of the
records holding it agree with the chosen value ("2 of 3 agree").
Two values that are the same once cleaned up ("12/05/1990" and "12-05-1990") agree. A PAN, Aadhaar or date of
birth that differs is a conflict: the golden record shows the chosen value but a person must confirm it.
"""

from . import normalize
from .score import LABELS

FIELDS = [
    ("name", "Name", "order"), ("dob", "Date of birth", "order"), ("gender", "Gender", "order"),
    ("pan", "PAN", "order"), ("aadhaar", "Aadhaar", "order"),
    ("mobile", "Mobile", "recent"), ("email", "Email", "recent"),
    ("address", "Address", "address"), ("city", "City", "address"), ("state", "State", "address"),
    ("pincode", "Pincode", "address"),
]
ADDRESS = ["address", "city", "state", "pincode"]
CRITICAL = {"pan", "aadhaar", "dob"}
RULE_TEXT = {"order": "Source order", "recent": "Most recent", "address": "Most recent address",
             "address-order": "Address by source order"}


def _clean(field, value):
    fix = normalize.NORMALIZERS.get(field)
    return fix(value) if fix else normalize.text(value).lower()


def _when(r):
    return r.updated_at.strftime("%d %b %Y") if r.updated_at else "no date"


def _newest(records):
    dated = [r for r in records if r.updated_at]
    return max(dated, key=lambda r: r.updated_at) if dated else None


def build(records, settings=None):
    """[{field, label, rule, value, record, why, conflict, others: [{record, value, why, same}]}] for a person's
    records (Profile objects with .source)."""
    settings = settings or {}
    order = settings.get("source_order") or []
    rules = {**{f: rule for f, _, rule in FIELDS}, **{f: ("address" if f == "address" and r == "recent" else r)
                                                      for f, r in (settings.get("field_rules") or {}).items()}}
    by_priority = sorted(records, key=lambda r: (order.index(r.source.code) if getattr(r.source, "code", None) in order else len(order),
                                                 -float(r.source.trust), r.source.name, -(getattr(r, "trust", None) or 0),
                                                 -(r.updated_at.timestamp() if r.updated_at else 0)))
    rank = {r.id: i for i, r in enumerate(by_priority)}
    with_address = [r for r in records if r.values.get("address")] or [r for r in records if any(r.values.get(f) for f in ADDRESS)]
    home = _newest(with_address) or (by_priority and next((r for r in by_priority if r in with_address), None))
    out = []
    for field, label, rule in FIELDS:
        rule = rules["address"] if field in ADDRESS else rules.get(field, rule)
        if field in ADDRESS and rule == "order":
            rule = "address-order"
        having = [r for r in records if r.values.get(field)]
        row = {"field": field, "label": label, "rule": RULE_TEXT[rule], "value": "", "record": None, "why": "",
               "conflict": False, "others": [], "agree": [0, 0]}
        if not having:
            row["why"] = "Missing in every source"
            out.append(row)
            continue
        if rule == "order":
            chosen = min(having, key=lambda r: rank[r.id])
            why = (f"Only {chosen.source.name} has it" if len({r.source_id for r in having}) == 1 and len(having) == 1
                   else f"{chosen.source.name} comes first in source order")
        elif rule == "recent":
            chosen = _newest(having) or min(having, key=lambda r: rank[r.id])
            why = (f"Only {chosen.source.name} has it" if len(having) == 1
                   else f"Most recently updated ({_when(chosen)})" if chosen.updated_at else f"No dates; {chosen.source.name} comes first in source order")
        elif rule == "address-order":
            first = min(with_address, key=lambda r: rank[r.id]) if with_address else None
            chosen = first if first in having else min(having, key=lambda r: rank[r.id])
            why = (f"Only {chosen.source.name} has it" if len(having) == 1
                   else f"From the address of {chosen.source.name}, first in source order")
        else:
            chosen = home if home in having else (_newest(having) or min(having, key=lambda r: rank[r.id]))
            why = (f"Only {chosen.source.name} has it" if len(having) == 1
                   else f"From the most recently updated address ({_when(chosen)})" if chosen.updated_at else f"{chosen.source.name} comes first in source order")
        mine = _clean(field, chosen.values[field])
        for r in having:
            if r is chosen:
                continue
            value = r.values[field]
            if field in ("pan", "aadhaar"):  # shown masked: compare the fingerprints of the real numbers
                same = bool(r.keys.get(field)) and r.keys.get(field) == chosen.keys.get(field)
            else:
                same = _clean(field, value) == mine
            if same:
                note = "Same value" if value == chosen.values[field] else "Same value, written another way"
            elif field in CRITICAL:
                note = f"Differs: {LABELS.get(field, label)} must be confirmed by a person"
                row["conflict"] = True
            elif rule in ("order", "address-order"):
                note = f"Not chosen: {r.source.name} comes later in source order"
            else:
                note = f"Not chosen: older ({_when(r)})" if r.updated_at else "Not chosen: no last-updated date"
            row["others"].append({"record": r, "value": value, "why": note, "same": bool(same)})
        row.update(value=chosen.values[field], record=chosen, why=why,
                   agree=[1 + sum(o["same"] for o in row["others"]), len(having)])
        out.append(row)
    return out


def snapshot(rows):
    """The golden record as saved: records become {id, source, key, trust, updated_at} so it is plain JSON."""
    side = lambda r: {"id": r.id, "source": r.source.name, "key": r.key, "trust": getattr(r, "trust", None),  # noqa: E731
                      "updated_at": r.updated_at.isoformat() if r.updated_at else None} if r else None
    return [{**x, "record": side(x["record"]), "others": [{**o, "record": side(o["record"])} for o in x["others"]]}
            for x in rows]


def fingerprint(rows):
    """What the golden record says, as one string: an approval stays valid only while this does not change."""
    return "|".join(f"{r['field']}={r['value']}" for r in rows)
