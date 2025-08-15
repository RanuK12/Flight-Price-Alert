"""
Analytics Master Hub - Main FastAPI Application
A comprehensive analytics platform for modern business intelligence.
"""

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import uvicorn
from loguru import logger
import time
from typing import Dict, Any

# Import modules
from api.routes import (
    business_analytics,
    financial_analytics,
    people_analytics,
    ecommerce_analytics,
    market_analytics,
    auth,
    users,
    dashboard
)
from core.config import settings
from core.database import init_db, close_db
from core.security import verify_token
from models.user import User

# Security
security = HTTPBearer()

# Global variables
app_start_time = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    global app_start_time
    
    # Startup
    logger.info("🚀 Starting Analytics Master Hub...")
    app_start_time = time.time()
    
    # Initialize database
    await init_db()
    logger.info("✅ Database initialized successfully")
    
    # Initialize ML models
    logger.info("🤖 Initializing ML models...")
    # TODO: Initialize ML models here
    
    # Initialize data pipelines
    logger.info("📊 Initializing data pipelines...")
    # TODO: Initialize data pipelines here
    
    startup_time = time.time() - app_start_time
    logger.info(f"🎉 Analytics Master Hub started successfully in {startup_time:.2f} seconds")
    
    yield
    
    # Shutdown
    logger.info("🛑 Shutting down Analytics Master Hub...")
    await close_db()
    logger.info("✅ Analytics Master Hub shutdown complete")

# Create FastAPI app
app = FastAPI(
    title="Analytics Master Hub",
    description="A comprehensive analytics platform for modern business intelligence",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request/Response middleware
@app.middleware("http")
async def add_process_time_header(request, call_next):
    """Add processing time to response headers"""
    start_time = time.time()
    response = await call_next(request)
    process_time = time.time() - start_time
    response.headers["X-Process-Time"] = str(process_time)
    return response

# Authentication dependency
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> User:
    """Get current authenticated user"""
    try:
        token = credentials.credentials
        user = await verify_token(token)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user
    except Exception as e:
        logger.error(f"Authentication error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

# Health check endpoint
@app.get("/health", tags=["Health"])
async def health_check() -> Dict[str, Any]:
    """Health check endpoint"""
    global app_start_time
    
    uptime = time.time() - app_start_time if app_start_time else 0
    
    return {
        "status": "healthy",
        "uptime_seconds": round(uptime, 2),
        "version": "1.0.0",
        "timestamp": time.time()
    }

# Root endpoint
@app.get("/", tags=["Root"])
async def root() -> Dict[str, Any]:
    """Root endpoint with API information"""
    return {
        "message": "Welcome to Analytics Master Hub",
        "version": "1.0.0",
        "description": "A comprehensive analytics platform for modern business intelligence",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/health"
    }

# Include routers
app.include_router(
    auth.router,
    prefix="/api/v1/auth",
    tags=["Authentication"]
)

app.include_router(
    users.router,
    prefix="/api/v1/users",
    tags=["Users"],
    dependencies=[Depends(get_current_user)]
)

app.include_router(
    dashboard.router,
    prefix="/api/v1/dashboard",
    tags=["Dashboard"],
    dependencies=[Depends(get_current_user)]
)

app.include_router(
    business_analytics.router,
    prefix="/api/v1/analytics/business",
    tags=["Business Analytics"],
    dependencies=[Depends(get_current_user)]
)

app.include_router(
    financial_analytics.router,
    prefix="/api/v1/analytics/financial",
    tags=["Financial Analytics"],
    dependencies=[Depends(get_current_user)]
)

app.include_router(
    people_analytics.router,
    prefix="/api/v1/analytics/people",
    tags=["People Analytics"],
    dependencies=[Depends(get_current_user)]
)

app.include_router(
    ecommerce_analytics.router,
    prefix="/api/v1/analytics/ecommerce",
    tags=["E-commerce Analytics"],
    dependencies=[Depends(get_current_user)]
)

app.include_router(
    market_analytics.router,
    prefix="/api/v1/analytics/market",
    tags=["Market Analytics"],
    dependencies=[Depends(get_current_user)]
)

# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Handle HTTP exceptions"""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": exc.detail,
            "status_code": exc.status_code,
            "timestamp": time.time()
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """Handle general exceptions"""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "status_code": 500,
            "timestamp": time.time()
        }
    )

# API metadata
@app.get("/api/v1", tags=["API Info"])
async def api_info() -> Dict[str, Any]:
    """API information and available endpoints"""
    return {
        "name": "Analytics Master Hub API",
        "version": "1.0.0",
        "description": "Comprehensive analytics platform API",
        "endpoints": {
            "authentication": "/api/v1/auth",
            "users": "/api/v1/users",
            "dashboard": "/api/v1/dashboard",
            "business_analytics": "/api/v1/analytics/business",
            "financial_analytics": "/api/v1/analytics/financial",
            "people_analytics": "/api/v1/analytics/people",
            "ecommerce_analytics": "/api/v1/analytics/ecommerce",
            "market_analytics": "/api/v1/analytics/market"
        },
        "documentation": {
            "swagger": "/docs",
            "redoc": "/redoc"
        }
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info"
    ) 