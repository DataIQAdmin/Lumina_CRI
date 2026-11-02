from django.core.serializers.json import DjangoJSONEncoder
from django.db import models

from sources.models import Source


class RawRecord(models.Model):
    """One row exactly as a source system sent it. Never edited; kept as proof of where data came from."""

    source = models.ForeignKey(Source, on_delete=models.PROTECT, related_name="raw_records")
    source_record_id = models.CharField(max_length=64)  # the customer's ID inside that system, e.g. "FX0000101"
    payload = models.JSONField(encoder=DjangoJSONEncoder)  # DjangoJSONEncoder lets dates be stored as JSON
    fetched_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-fetched_at"]
        indexes = [models.Index(fields=["source", "source_record_id"])]

    def __str__(self):
        return f"{self.source.code}:{self.source_record_id} @ {self.fetched_at:%Y-%m-%d %H:%M}"


class SourceRecord(models.Model):
    """The latest cleaned version of one customer from one source, in Lumina's standard fields."""

    source = models.ForeignKey(Source, on_delete=models.PROTECT, related_name="records")
    source_record_id = models.CharField(max_length=64)
    name = models.CharField(max_length=200, blank=True)
    father_name = models.CharField(max_length=200, blank=True)
    dob = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=10, blank=True)
    # PAN and CKYC are encrypted (security/crypto.py). The *_hash columns hold a keyed fingerprint so
    # records can be matched without decrypting. Aadhaar: last 4 digits only, never the full number.
    pan = models.TextField(blank=True)
    pan_hash = models.CharField(max_length=64, blank=True, db_index=True)
    aadhaar = models.CharField(max_length=4, blank=True)
    ckyc = models.TextField(blank=True)
    ckyc_hash = models.CharField(max_length=64, blank=True, db_index=True)
    mobile = models.CharField(max_length=10, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=300, blank=True)  # current address
    perm_address = models.CharField(max_length=300, blank=True)
    occupation = models.CharField(max_length=100, blank=True)
    income = models.CharField(max_length=60, blank=True)  # an income band, e.g. "10 to 25 lakh"
    country = models.CharField(max_length=60, blank=True)  # country of residence, e.g. "United Arab Emirates"
    residency = models.CharField(max_length=20, blank=True)  # "Resident", "NRI" or "Foreign national"
    # Fields Lumina worked out itself because the system did not send them (ingestion/places.py), e.g. ["country"].
    guessed = models.JSONField(default=list, blank=True)
    source_updated_at = models.DateTimeField(null=True, blank=True)  # when the source system last changed this row
    # False while the part of the source it came from is switched off (a suspended file), so it is left out of
    # matching and golden records without being deleted: switching back on restores it with the same customer.
    active = models.BooleanField(default=True)
    origin_file = models.ForeignKey("sources.UploadedFile", null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name="+")  # for file uploads: the file this row was last read from
    origin_table = models.CharField(max_length=20, blank=True)  # for database connectors: "main" or an added table
    # Data profiling (ingestion/profiling.py): checks on the values as the system sent them, e.g.
    # {"mobile.digits": "9 digits"}, and those values for display (identity numbers already masked).
    profile = models.JSONField(default=dict, blank=True)
    sent_values = models.JSONField(default=dict, blank=True)
    synced_at = models.DateTimeField(auto_now=True)  # when Lumina last read it

    class Meta:
        ordering = ["source", "source_record_id"]
        constraints = [
            models.UniqueConstraint(fields=["source", "source_record_id"], name="unique_record_per_source"),
        ]

    def __str__(self):
        return f"{self.source.code}:{self.source_record_id} {self.name}"


class RawTable(models.Model):
    """One table (or collection, or uploaded CSV file) of a source system, read whole for data profiling.
    The raw layer: every column and row as the system holds it, before any cleaning (ingestion/raw.py)."""

    source = models.ForeignKey(Source, on_delete=models.CASCADE, related_name="raw_tables")
    name = models.CharField(max_length=200)  # e.g. "core.customer_master", or the file name without ".csv"
    columns = models.JSONField(default=list)
    sensitive = models.JSONField(default=list)  # identity-number columns, kept only masked (see raw.protect)
    rows = models.PositiveIntegerField(default=0)
    complete = models.BooleanField(default=True)  # False when the table had more rows than Lumina reads
    read_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["source", "name"]
        constraints = [models.UniqueConstraint(fields=["source", "name"], name="unique_raw_table_per_source")]

    def __str__(self):
        return f"{self.source.code}:{self.name}"


class RawRow(models.Model):
    """One row of a RawTable: its values in the table's column order."""

    table = models.ForeignKey(RawTable, on_delete=models.CASCADE, related_name="row_set")
    position = models.PositiveIntegerField()
    values = models.JSONField(encoder=DjangoJSONEncoder)
    # For identity-number columns: {column: [shape, fingerprint]}, e.g. ["AAAAA9999A", "3f9c..."], so profiling
    # can check the pattern and find duplicates without the readable number ever being stored.
    protected = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["table", "position"]
        indexes = [models.Index(fields=["table", "position"])]
