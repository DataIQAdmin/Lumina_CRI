from django.db import models

from sources.models import Source


class Profile(models.Model):
    """One customer as one source system knows them, built from the source's clean rows and its field mapping
    (matching/profiles.py). Several profiles of the same real person are linked by MatchPairs into one person."""

    source = models.ForeignKey(Source, on_delete=models.CASCADE, related_name="profiles")
    key = models.CharField(max_length=200)  # the source's Customer ID, e.g. a CIF or an app user ID
    # What the screens show, field by field: {"name": "Rohan Kumar", "pan": "XXXXXX234F", ...} (identity masked).
    values = models.JSONField(default=dict)
    # What matching compares, cleaned up: names in lower case, dates as YYYY-MM-DD, mobiles as 10 digits, PAN and
    # Aadhaar only as fingerprints (never readable).
    keys = models.JSONField(default=dict)
    # Where each field came from: {"name": "core.customer_master", ...}
    tables = models.JSONField(default=dict)
    updated_at = models.DateTimeField(null=True, blank=True)  # newest "Last updated" of its rows
    person = models.CharField(max_length=20, blank=True, db_index=True)  # the group it belongs to, e.g. "P-12"
    rows = models.JSONField(default=dict)  # {"total": 3, "clean": 2}: the customer's rows in mapped tables
    held = models.JSONField(default=list)  # fields with a value only in held-back rows, e.g. ["pan"]
    # Trust score (matching/trust.py): 0-100 from the five rules, its band, each rule's score and why, and what
    # keeps the band at Review whatever the score.
    trust = models.PositiveSmallIntegerField(null=True, blank=True)
    band = models.CharField(max_length=10, blank=True)
    parts = models.JSONField(default=dict)
    holds = models.JSONField(default=list)
    built_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["source", "key"]
        constraints = [models.UniqueConstraint(fields=["source", "key"], name="unique_profile_per_source")]

    def __str__(self):
        return f"{self.source.code}:{self.key}"


class MatchPair(models.Model):
    """Two profiles that may be the same person, with the score and every point behind it."""

    MATCHED, REVIEW, CONFIRMED, REJECTED = "matched", "review", "confirmed", "rejected"
    STATUS_CHOICES = [(MATCHED, "Matched automatically"), (REVIEW, "To review"), (CONFIRMED, "Same person"),
                      (REJECTED, "Not the same")]

    a = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="+")
    b = models.ForeignKey(Profile, on_delete=models.CASCADE, related_name="+")
    score = models.PositiveSmallIntegerField()
    # [{field, label, result: same|similar|different|missing, points, a, b}]
    points = models.JSONField(default=list)
    conflicts = models.JSONField(default=list)  # ["PAN differs", ...]: never matched automatically
    status = models.CharField(max_length=10, choices=STATUS_CHOICES)
    decided_by = models.CharField(max_length=150, blank=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-score"]
        constraints = [models.UniqueConstraint(fields=["a", "b"], name="one_pair_per_two_profiles")]

    def __str__(self):
        return f"{self.a} ~ {self.b} ({self.score}, {self.status})"


class MatchRun(models.Model):
    """When matching last ran and what it found, for the summary on screen."""

    ran_at = models.DateTimeField(auto_now_add=True)
    ran_by = models.CharField(max_length=150, blank=True)
    summary = models.JSONField(default=dict)

    class Meta:
        ordering = ["-ran_at"]
