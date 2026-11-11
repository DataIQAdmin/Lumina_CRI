from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import admin_views, connector_views, ingest_views, interaction_views, profiling_views, raw_views, rule_views, views

router = DefaultRouter()
router.register("sources", views.SourceViewSet, basename="source")
router.register("customers", views.CustomerViewSet, basename="customer")
router.register("suggestions", views.MatchSuggestionViewSet, basename="suggestion")
router.register("audit", views.AuditEventViewSet, basename="audit")
router.register("corrections", views.FieldCorrectionViewSet, basename="correction")
router.register("users", admin_views.UserViewSet, basename="user")

urlpatterns = [
    path("profiling/", profiling_views.summary),
    path("profiling/records/", profiling_views.records),
    path("raw/", raw_views.sources),
    path("raw/<slug:code>/", raw_views.tables),
    path("raw/<slug:code>/discover/", raw_views.discover),
    path("raw/<slug:code>/read/", raw_views.read),
    path("raw/<slug:code>/rows/", raw_views.rows),
    path("raw/<slug:code>/proof/", raw_views.proof),
    path("raw/<slug:code>/profile/", raw_views.profile),
    path("rules/<slug:code>/", rule_views.rules),
    path("rules/<slug:code>/preview/", rule_views.preview),
    path("rules/<slug:code>/suggest/", rule_views.suggest),
    path("rules/<slug:code>/remove/", rule_views.remove),
    path("regex/check/", rule_views.check),
    path("regex/library/", rule_views.library),
    path("regex/library/<int:pk>/", rule_views.library_item),
    path("regex/test/", rule_views.test),
    path("silver/<slug:code>/", rule_views.silver_tables),
    path("silver/<slug:code>/rows/", rule_views.silver_rows),
    path("pipeline/", rule_views.pipeline),
    path("customers/<int:pk>/interactions/", interaction_views.customer_interactions),
    path("customers/<int:pk>/briefing/", interaction_views.customer_briefing),
    path("interactions/open/", interaction_views.open_items),
    path("interactions/<int:pk>/close/", interaction_views.close),
    path("auth/csrf/", views.csrf),
    path("auth/login/", views.login_view),
    path("auth/logout/", views.logout_view),
    path("auth/me/", views.me),
    path("auth/change-password/", admin_views.change_password),
    path("settings/trust/", admin_views.trust_settings),
    path("settings/logo/", admin_views.organization_logo),
    path("connectors/catalog/", connector_views.catalog),
    path("connectors/", connector_views.create_connector),
    path("connectors/<slug:code>/", connector_views.update_connector),
    path("connectors/<slug:code>/test/", connector_views.test_connector),
    path("connectors/<slug:code>/trust/", connector_views.field_trust),
    path("connectors/<slug:code>/discover/", connector_views.discover),
    path("connectors/<slug:code>/mapping/", connector_views.save_mapping),
    path("connectors/<slug:code>/accounts-mapping/", connector_views.save_accounts_mapping),
    path("connectors/<slug:code>/delete/", connector_views.delete_connector),
    path("connectors/<slug:code>/upload/", connector_views.upload_file),
    path("connectors/<slug:code>/tables/", connector_views.save_customer_table),
    path("connectors/<slug:code>/tables/status/", connector_views.table_status),
    path("connectors/<slug:code>/tables/remove/", connector_views.remove_tables_view),
    path("connectors/<slug:code>/files/", connector_views.list_files),
    path("connectors/<slug:code>/files/status/", connector_views.file_status),
    path("connectors/<slug:code>/files/remove/", connector_views.remove_files_view),
    path("connectors/<slug:code>/runs/", connector_views.sync_runs),
    path("connectors/<slug:code>/api-key/", connector_views.create_api_key),
    # Push API: a bank system sends records with its connector's API key (no sign-in session).
    path("ingest/<slug:code>/", ingest_views.ingest),
    path("overview/", views.overview),
    path("reference/", views.reference),
    path("compliance/", views.compliance_queue),
    path("", include(router.urls)),
]
