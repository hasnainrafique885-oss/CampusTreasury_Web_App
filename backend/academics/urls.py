from rest_framework.routers import DefaultRouter

from .views import (
    AcademicYearViewSet, DepartmentViewSet, SchoolClassViewSet,
    SectionViewSet, StudentViewSet, TransportStatusViewSet,
)

router = DefaultRouter()
router.register('academic-years', AcademicYearViewSet, basename='academicyear')
router.register('departments', DepartmentViewSet, basename='department')
router.register('classes', SchoolClassViewSet, basename='schoolclass')
router.register('sections', SectionViewSet, basename='section')
router.register('students', StudentViewSet, basename='student')
router.register('transport-status', TransportStatusViewSet, basename='transportstatus')

urlpatterns = router.urls
