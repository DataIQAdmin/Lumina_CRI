"""Column rules: one regular expression per column, written by the user. The silver layer is built only from them.

A value passes when the whole value matches, so \\d{10} fails on 11 digits. An empty value is tested like any
other: it fails unless the regex allows empty. A row reaches silver only if it passes every rule of its table;
every other row stays in rejected. A table with no rule has no silver rows at all.

Users type these expressions, and a badly written one can run for a very long time, so each job has a time limit.
"""

import time

import regex

from security import crypto

from .models import ColumnRule, RawRow

MAX_PATTERN = 300
TIME_LIMIT = 4.0  # seconds for one job (a preview, one table's silver, one table in the tester)
PREVIEW_ROWS = 10


class RuleError(ValueError):
    pass


def compile_rule(pattern):
    """The compiled expression, or RuleError saying what is wrong with it."""
    if not pattern or not pattern.strip():
        raise RuleError("Type a regular expression first.")
    if len(pattern) > MAX_PATTERN:
        raise RuleError(f"Keep the regular expression under {MAX_PATTERN} characters.")
    try:
        return regex.compile(pattern)
    except regex.error as exc:
        raise RuleError(f"Not a valid regular expression: {exc.msg}.") from exc


class Clock:
    """Shares one time limit across all the values of a job."""

    def __init__(self):
        self.ends = time.monotonic() + TIME_LIMIT

    def matches(self, compiled, text):
        left = self.ends - time.monotonic()
        try:
            if left <= 0:
                raise TimeoutError
            return compiled.fullmatch(text, timeout=left) is not None
        except TimeoutError:
            raise RuleError("This regular expression takes too long to run. Please simplify it.") from None


def text_of(value):
    return "" if value is None else str(value)


def readable(columns, values, protected):
    """A stored row with identity numbers put back, for checking only. Never send this to the screen."""
    out = list(values)
    for column, kept in (protected or {}).items():
        if len(kept) > 2 and column in columns:
            out[columns.index(column)] = crypto.decrypt(kept[2])
    return out


def rows_of(table):
    """[(position, readable values, values for the screen)] of a table, in order."""
    found = RawRow.objects.filter(table=table).order_by("position").values_list("position", "values", "protected")
    return [(position, readable(table.columns, values, protected), values) for position, values, protected in found]


def preview(table, column, pattern):
    """What a regex would do to one column, before it is applied: totals, and PREVIEW_ROWS rows showing both
    results when the column has both, at most half of them failures unless too few rows passed."""
    compiled = compile_rule(pattern)
    i = table.columns.index(column)
    clock = Clock()
    results = [(position, shown[i], clock.matches(compiled, text_of(plain[i])))
               for position, plain, shown in rows_of(table)]
    passed = [r for r in results if r[2]]
    failed = [r for r in results if not r[2]]
    show_failed = max(PREVIEW_ROWS // 2, PREVIEW_ROWS - len(passed))
    chosen = failed[:show_failed]
    chosen += passed[:PREVIEW_ROWS - len(chosen)]
    return {"total": len(results), "passed": len(passed), "failed": len(failed),
            "sample": [{"position": p, "value": v, "passed": ok} for p, v, ok in sorted(chosen, key=lambda r: r[0])]}


def table_rules(table):
    """{column: pattern} applied to this table, for columns it still has."""
    rules = ColumnRule.objects.filter(source=table.source, table=table.name, column__in=table.columns)
    return {r.column: r.pattern for r in rules}


def split(table):
    """(passed, rejected) rows of a table under its applied rules. passed: [(position, values)]; rejected:
    [(position, values, columns it failed)]. Values are as shown on screen, identity numbers masked."""
    rules = [(table.columns.index(c), c, compile_rule(p)) for c, p in table_rules(table).items()]
    if not rules:
        return [], []
    clock = Clock()
    passed, rejected = [], []
    for position, plain, shown in rows_of(table):
        broken = [c for i, c, compiled in rules if not clock.matches(compiled, text_of(plain[i]))]
        if broken:
            rejected.append((position, shown, broken))
        else:
            passed.append((position, shown))
    return passed, rejected


def test_table(table, pattern):
    """How well a regex fits every column of a table: [{column, matched, filled}], best fit first. Empty values are
    left out, so a column is judged only on what it holds."""
    compiled = compile_rule(pattern)
    clock = Clock()
    rows = rows_of(table)
    out = []
    for i, column in enumerate(table.columns):
        filled = [v for v in (text_of(plain[i]) for _, plain, _ in rows) if v.strip()]
        if filled:
            matched = sum(clock.matches(compiled, v) for v in filled)
            out.append({"column": column, "matched": matched, "filled": len(filled)})
    return sorted(out, key=lambda c: -c["matched"] / c["filled"])
