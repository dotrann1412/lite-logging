import fastapi 
import fastapi.staticfiles
import asyncio
import logging 

logging_fmt = "%(asctime)s - %(message)s"
logging.basicConfig(level=logging.INFO, format=logging_fmt)
logger = logging.getLogger(__name__)

from lite_logging_server.apis.v1 import api_router as api_router_v1
from lite_logging_server.apis.v2 import api_router as api_router_v2
from lite_logging_server.apis.v3 import api_router as api_router_v3

from fastapi import Request, Response, HTTPException
from typing import Callable

async def lifespan(app: fastapi.FastAPI):
    """
    Lifespan event handler for the FastAPI application.
    """
    
    try:
        logger.info(f"Starting lifespan; Serving lite-logging")
        yield
    except Exception as e:
        logger.error(f"Error in lifespan: {e}")
        raise e

server_app = fastapi.FastAPI(
    lifespan=lifespan, 
    docs_url=None, 
    redoc_url=None,
    openapi_url=None
)

server_app.include_router(api_router_v1, prefix="/api")
server_app.include_router(api_router_v1, prefix="/api/v1")
server_app.include_router(api_router_v2, prefix="/api/v2")
server_app.include_router(api_router_v3, prefix="/api/v3")
server_app.mount("/", fastapi.staticfiles.StaticFiles(directory="public"), name="web")

@server_app.get("/health")
async def healthcheck():
    return {"status": "ok", "message": "Yo, I am alive"}

with open("public/index.html") as f:
    index_html = f.read()

@server_app.exception_handler(404)
async def custom_404_handler(request: Request, exc: HTTPException):
    if request.url.path == "/":
        return fastapi.responses.HTMLResponse(content=index_html)

    return fastapi.responses.RedirectResponse(url="/index.html", status_code=302)

@server_app.middleware("http")
async def log_request_processing_time(request: Request, call_next: Callable) -> Response:
    start_time = asyncio.get_event_loop().time()
    response: Response = await call_next(request)
    duration = asyncio.get_event_loop().time() - start_time

    if request.url.path.startswith((api_router_v1.prefix, api_router_v2.prefix, api_router_v3.prefix)):
        logger.info(f"{request.method} - {request.url.path} - {duration:.4f} seconds - {response.status_code}")

    return response
