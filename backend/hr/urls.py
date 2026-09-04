from rest_framework.routers import DefaultRouter

from .views import EmployeeViewSet, IncrementViewSet, LeaveViewSet

router = DefaultRouter()
router.register('employees', EmployeeViewSet, basename='employee')
router.register('increments', IncrementViewSet, basename='increment')
router.register('leaves', LeaveViewSet, basename='leave')

urlpatterns = router.urls
