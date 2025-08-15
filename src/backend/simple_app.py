"""
Simple FastAPI application for testing
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Create FastAPI app
app = FastAPI(
    title="Analytics Master Hub",
    description="A comprehensive analytics platform for modern business intelligence",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
async def root():
    return {
        "message": "Welcome to Analytics Master Hub",
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Analytics Master Hub Backend"
    }

@app.get("/api/v1/analytics/business")
async def business_analytics():
    return {
        "module": "Business Analytics",
        "features": [
            "Revenue Analysis",
            "Customer Analytics", 
            "Operational Metrics",
            "Competitive Intelligence"
        ],
        "status": "ready"
    }

@app.get("/api/v1/analytics/financial")
async def financial_analytics():
    return {
        "module": "Financial Analytics",
        "features": [
            "Portfolio Management",
            "Risk Analysis",
            "Investment Analytics",
            "Cryptocurrency Analysis"
        ],
        "status": "ready"
    }

@app.get("/api/v1/analytics/people")
async def people_analytics():
    return {
        "module": "People Analytics",
        "features": [
            "Employee Performance",
            "Recruitment Analytics",
            "Culture Analytics",
            "Diversity & Inclusion"
        ],
        "status": "ready"
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000) 