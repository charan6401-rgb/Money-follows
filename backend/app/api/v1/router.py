from fastapi import APIRouter

from app.modules.customers.router import router as customers_router
from app.modules.identity.router import router as identity_router
from app.modules.invoices.router import router as invoices_router
from app.modules.payments.router import router as payments_router
from app.modules.reports.router import router as reports_router

api_router = APIRouter()
api_router.include_router(identity_router)
api_router.include_router(customers_router)
api_router.include_router(invoices_router)
api_router.include_router(payments_router)
api_router.include_router(reports_router)
