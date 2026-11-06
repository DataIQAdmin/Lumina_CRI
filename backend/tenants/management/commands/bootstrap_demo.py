import os

from django.conf import settings
from django.contrib.auth.models import Group, User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django_tenants.utils import schema_context

from accounts.management.commands.seed_demo_users import DEMO_USERS
from compliance.services import feed_file, import_feed
from ingestion.retire import remove_demo_sources
from mdm.models import GoldenField
from mdm.services import rebuild_customers
from tenants.models import Tenant


class Command(BaseCommand):
    help = (
        "Hosted demo start-up, safe on every start. Creates the demo organizations and loads their data once "
        "(setup_tenants), then sets logins from environment variables in every organization: DEMO_PASSWORD for "
        "the four role logins, DJANGO_SUPERUSER_USERNAME / DJANGO_SUPERUSER_PASSWORD for the organization admin. "
        "The same admin name and password are also the platform login in the shared schema. With DEMO_SOURCES=off "
        "it removes the built-in demo sources from every organization."
    )

    def handle(self, *args, **options):
        call_command("setup_tenants", stdout=self.stdout)

        demo_password = os.getenv("DEMO_PASSWORD", "")
        admin_name = os.getenv("DJANGO_SUPERUSER_USERNAME", "")
        admin_password = os.getenv("DJANGO_SUPERUSER_PASSWORD", "")
        if demo_password:
            self._check(demo_password, "DEMO_PASSWORD")
        if admin_password:
            self._check(admin_password, "DJANGO_SUPERUSER_PASSWORD")

        for tenant in Tenant.objects.exclude(schema_name="public"):
            with schema_context(tenant.schema_name):
                if not settings.DEMO_SOURCES:
                    removed = remove_demo_sources()
                    if removed.sources:
                        self.stdout.write(
                            f"{tenant.name}: removed {removed.sources} demo sources, {removed.records} records, "
                            f"{removed.customers_removed} customers."
                        )
                if GoldenField.objects.filter(score_trust__isnull=True).exists():
                    rebuild_customers()  # once after a scoring change: values saved before it have no score_trust
                    self.stdout.write(f"{tenant.name}: trust scores recalculated.")
                if settings.DEMO_SOURCES and feed_file().exists():
                    import_feed()  # picks up changes to the compliance feed; unchanged rows stay as they are
                if demo_password:
                    for username, first, last, group_name in DEMO_USERS:
                        user, _ = User.objects.get_or_create(
                            username=username, defaults={"first_name": first, "last_name": last}
                        )
                        user.set_password(demo_password)
                        user.save()
                        user.groups.set([Group.objects.get(name=group_name)])
                if admin_name and admin_password:
                    self._superuser(admin_name, admin_password)
            self.stdout.write(f"{tenant.name}: logins ready.")

        if admin_name and admin_password:
            with schema_context("public"):  # the platform login lives in the shared schema
                self._superuser(admin_name, admin_password)
            self.stdout.write(f"Platform login ready: {admin_name}")

    def _superuser(self, name, password):
        admin, _ = User.objects.get_or_create(username=name)
        admin.is_staff = admin.is_superuser = True
        admin.set_password(password)
        admin.save()

    def _check(self, password, name):
        try:
            validate_password(password)
        except ValidationError as exc:
            raise CommandError(f"{name} is too weak: {' '.join(exc.messages)}") from exc
