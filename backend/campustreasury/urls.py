"""URL configuration for the CampusTreasury backend."""
from django.contrib import admin
from django.urls import include, path
from django.http import JsonResponse

# Simple Root View
def root_status(request):
    return JsonResponse({
        "status": "online",
        "message": "CampusTreasury API is running successfully!",
        "endpoints": {
            "admin": "/admin/",
            "accounts": "/api/",
            "academics": "/api/academics/",
            "hr": "/api/hr/",
            "finance": "/api/finance/"
        }
    })

urlpatterns = [
    path('', root_status, name='api-root'), # Is line se main domain ka 404 khatam ho jayega
    path('admin/', admin.site.urls),
    path('api/', include('accounts.urls')),
    path('api/academics/', include('academics.urls')),
    path('api/hr/', include('hr.urls')),
    path('api/finance/', include('finance.urls')),
]