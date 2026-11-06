from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django_tenants.utils import schema_context

from mdm.models import Customer
from tenants.models import Domain, Tenant

# The demo organizations. code = schema name = what people type at sign-in = /t/<code>/ in addresses.
DEMO_ORGS = [
    ("axis", "Axis Bank", "#97144d"),
    ("hdfc", "HDFC Bank", "#004c8f"),
]


def ensure_public_tenant():
    """django-tenants needs a row for the shared "public" schema (the platform's own space)."""
    tenant, _ = Tenant.objects.get_or_create(schema_name="public", defaults={"name": "Lumina platform"})
    return tenant


def load_demo_data(code, stdout):
    """Fill one organization from fake_sources/<code>/: core banking, Salesforce, branch files, compliance.
    With DEMO_SOURCES=off nothing is loaded; data comes from the bank's own connectors."""
    with schema_context(code):
        if settings.DEMO_SOURCES:
            call_command("load_fake_flexcube", stdout=stdout)
            for source in ["flexcube", "salesforce", "branch_csv"]:
                call_command("sync", source, stdout=stdout)
            call_command("build_customers", stdout=stdout)
            call_command("sync_compliance", stdout=stdout)


class Command(BaseCommand):
    help = (
        "Create the demo organizations (Axis Bank, HDFC Bank) with their own schemas, and load each one's "
        "synthetic data the first time. Safe to run again: existing organizations and data are left alone."
    )

    def add_arguments(self, parser):
        parser.add_argument("--no-data", action="store_true", help="Create the organizations but load no data.")

    def handle(self, *args, no_data=False, **options):
        ensure_public_tenant()
        for code, name, colour in DEMO_ORGS:
            tenant = Tenant.objects.filter(schema_name=code).first()
            if tenant is None:
                self.stdout.write(f"Creating {name} (schema {code}) ...")
                tenant = Tenant.objects.create(schema_name=code, name=name, brand_color=colour)
            Domain.objects.get_or_create(domain=code, defaults={"tenant": tenant, "is_primary": True})

            with schema_context(code):
                has_data = Customer.objects.exists()
            if no_data or has_data:
                self.stdout.write(f"{name}: {'data already loaded' if has_data else 'no data requested'}.")
            else:
                load_demo_data(code, self.stdout)
                self.stdout.write(self.style.SUCCESS(f"{name}: demo data loaded."))
