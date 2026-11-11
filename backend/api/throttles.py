"""Tighter rate limits for the endpoints people could hammer: sign-in, the push API and the AI helper."""

from rest_framework.throttling import AnonRateThrottle, SimpleRateThrottle, UserRateThrottle


class LoginThrottle(AnonRateThrottle):
    """10 sign-in attempts a minute from one IP address, on top of the per-account lockout."""

    scope = "login"


class AiThrottle(UserRateThrottle):
    """20 AI regex suggestions a minute per person: the free model has its own limits."""

    scope = "ai"


class IngestThrottle(SimpleRateThrottle):
    """120 push batches a minute per connector."""

    scope = "ingest"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": view.kwargs.get("code", "")}
