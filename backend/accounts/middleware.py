import json
from django.utils.deprecation import MiddlewareMixin


def _client_ip(request):
    xff = request.META.get('HTTP_X_FORWARDED_FOR')
    if xff:
        return xff.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


# Endpoints under these path prefixes are skipped — noisy / not business data.
_SKIP_PREFIXES = ('/api/auth/', '/admin/', '/static/')

_METHOD_ACTION = {
    'POST': 'create',
    'PUT': 'update',
    'PATCH': 'update',
    'DELETE': 'delete',
}


class AuditLogMiddleware(MiddlewareMixin):
    """
    Lightweight, app-agnostic audit trail: any successful (2xx) write request
    (POST/PUT/PATCH/DELETE) against the API is logged with who made it, the
    path (which encodes the resource, e.g. /api/finance/fees/12/), and the
    response status. This reproduces the spirit of the frontend's AUDIT[]
    log without needing bespoke signal handlers on every model.
    """

    def process_response(self, request, response):
        try:
            path = request.path
            if not path.startswith('/api/'):
                return response
            if any(path.startswith(p) for p in _SKIP_PREFIXES):
                return response
            action = _METHOD_ACTION.get(request.method)
            if not action:
                return response
            if response.status_code >= 400:
                return response

            from .models import AuditLog

            user = getattr(request, 'user', None)
            is_auth = bool(user and getattr(user, 'is_authenticated', False))

            model_name = path.strip('/').split('/')
            model_name = model_name[2] if len(model_name) > 2 else path

            AuditLog.objects.create(
                user=user if is_auth else None,
                username_snapshot=user.username if is_auth else 'anonymous',
                action=action,
                model_name=model_name,
                object_repr=path,
                path=path,
                method=request.method,
                ip_address=_client_ip(request),
                details={'status_code': response.status_code},
            )
        except Exception:
            # Auditing must never break the actual request.
            pass
        return response
