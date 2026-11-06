"""Empty one organization for the rebuild: everything read from connectors, and everything built from it.

Stays: organizations, users, roles and passwords, the audit log, settings, and each connector's connection (its
address and encrypted password), so the rebuilt tables can be read without setting connectors up again. Schedules
and field mappings go, so nothing fills the old tables again.
"""

from dataclasses import dataclass, field

from django.db import transaction

from .connectors.catalog import DEMO_TYPES


def _models():
    from compliance.models import ConsentRecord, KycRecord
    from ingestion.models import ColumnRule, RawRecord, RawTable, SourceRecord
    from interactions.models import Interaction
    from mdm.models import Customer, CustomerLink, FieldCorrection, GoldenField, MatchSuggestion
    from products.models import Holding
    from sources.models import SyncRun, UploadedFile

    # In delete order: each one before what it points to.
    return [GoldenField, FieldCorrection, Interaction, MatchSuggestion, CustomerLink, Customer, Holding, KycRecord,
            ConsentRecord, SourceRecord, RawRecord, ColumnRule, RawTable, SyncRun, UploadedFile]


@dataclass
class CleanResult:
    rows: dict = field(default_factory=dict)  # {model name: rows}
    demo_connectors: int = 0
    connectors_kept: int = 0


def plan():
    """What clean_start() would remove, without changing anything."""
    from sources.models import Source

    demo = Source.objects.filter(connector_type__in=DEMO_TYPES).count()
    return CleanResult(rows={m.__name__: m.objects.count() for m in _models()}, demo_connectors=demo,
                       connectors_kept=Source.objects.count() - demo)


@transaction.atomic
def clean_start():
    from sources.models import Source

    result = plan()
    for model in _models():
        model.objects.all().delete()
    Source.objects.filter(connector_type__in=DEMO_TYPES).delete()
    Source.objects.update(mapping={}, field_trust={}, sync_every_hours=0, last_synced_at=None)
    return result
