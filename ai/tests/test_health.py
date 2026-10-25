import sys
from pathlib import Path

# Ensure ai directory is on sys.path when pytest runs from ai/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    """Create a FastAPI test client instance for testing endpoints."""
    return TestClient(app)


def test_health_status_code(client: TestClient):
    """Verify that GET /health returns HTTP 200 status code."""
    response = client.get("/health")
    assert response.status_code == 200


def test_health_status_value(client: TestClient):
    """Verify that GET /health response contains status = 'healthy'."""
    response = client.get("/health")
    data = response.json()
    assert data.get("status") == "healthy"


def test_health_service_and_version(client: TestClient):
    """Verify that service name and version match application configuration."""
    response = client.get("/health")
    data = response.json()
    assert data.get("service") == app.title
    assert data.get("version") == app.version
    assert data.get("service") == "SaveBite AI Service"
    assert data.get("version") == "0.1.0"


def test_health_json_structure(client: TestClient):
    """Verify that response is valid JSON with the exact expected fields."""
    response = client.get("/health")
    assert "application/json" in response.headers.get("content-type", "")
    data = response.json()
    assert isinstance(data, dict)
    assert set(data.keys()) == {"status", "service", "version"}
    assert data == {
        "status": "healthy",
        "service": "SaveBite AI Service",
        "version": "0.1.0",
    }


def test_docs_endpoint(client: TestClient):
    """Verify that Swagger UI documentation endpoint GET /docs returns HTTP 200."""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "html" in response.headers.get("content-type", "").lower()


def test_openapi_schema(client: TestClient):
    """Verify that GET /openapi.json returns HTTP 200 and includes /health endpoint."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "paths" in schema
    assert "/health" in schema["paths"]
    assert "get" in schema["paths"]["/health"]
    assert schema["info"]["title"] == "SaveBite AI Service"
    assert schema["info"]["version"] == "0.1.0"
