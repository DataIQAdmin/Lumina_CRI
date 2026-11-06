from django.core.management.base import BaseCommand
from django_tenants.utils import schema_context

from ingestion.clean_start import clean_start, plan
from tenants.models import Tenant


class Command(BaseCommand):
    help = (
        "Remove everything read from connectors and built from it, in every organization. Logins, the audit log, "
        "settings and connector connections stay. Cannot be undone. Use --dry-run first to see what would go."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Only show what would be removed.")

    def handle(self, *args, dry_run=False, **options):
        for tenant in Tenant.objects.exclude(schema_name="public"):
            with schema_context(tenant.schema_name):
                result = plan() if dry_run else clean_start()
            verb = "Would remove" if dry_run else "Removed"
            self.stdout.write(self.style.SUCCESS(f"{tenant.name}: {verb}"))
            for name, rows in result.rows.items():
                if rows:
                    self.stdout.write(f"  {name:<18} {rows:>8}")
            self.stdout.write(f"  {result.demo_connectors} demo connectors, {result.connectors_kept} connectors kept.")
