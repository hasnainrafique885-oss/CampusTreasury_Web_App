"""URL configuration for the CampusTreasury backend."""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('accounts.urls')),
    path('api/academics/', include('academics.urls')),
    path('api/hr/', include('hr.urls')),
    path('api/finance/', include('finance.urls')),
]
