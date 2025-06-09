import fastapi 
import fastapi.staticfiles
import uvicorn
import asyncio
from fastapi.middleware.cors import CORSMiddleware
import logging 

logging_fmt = "%(asctime)s - %(message)s"
logging.basicConfig(level=logging.INFO, format=logging_fmt)
logger = logging.getLogger(__name__)

from app.apis import api_router
import time
from fastapi import Request, Response, HTTPException
from fastapi.responses import FileResponse
from typing import Callable
import os

async def lifespan(app: fastapi.FastAPI):
    """
    Lifespan event handler for the FastAPI application.
    """
    
    host, port = os.getenv("HOST", "0.0.0.0"), os.getenv("PORT", 80)
    
    try:
        logger.info(f"Starting lifespan; Serving on {host}:{port}")
        yield
    except Exception as e:
        logger.error(f"Error in lifespan: {e}")
        raise e


def main():
    host, port = os.getenv("HOST", "0.0.0.0"), os.getenv("PORT", 80)

    server_app = fastapi.FastAPI(
        lifespan=lifespan
    )

    server_app.include_router(api_router)
    server_app.mount("/", fastapi.staticfiles.StaticFiles(directory="public"), name="web")

    @server_app.get("/health")
    async def healthcheck():
        return {"status": "ok", "message": "Yo, I am alive"}
    
    @server_app.exception_handler(404)
    async def custom_404_handler(request: Request, exc: HTTPException):
        """
        Handle 404 errors by serving index.html for client-side routing support
        """
        # Check if the request is for an API endpoint
        if request.url.path.startswith(api_router.prefix):
            return fastapi.responses.JSONResponse(
                status_code=404,
                content={"detail": "Not Found"}
            )
        
        # For all other requests, serve index.html to support client-side routing
        return FileResponse("public/index.html")
    
    @server_app.middleware("http")
    async def log_request_processing_time(request: Request, call_next: Callable) -> Response:
        start_time = asyncio.get_event_loop().time()
        response: Response = await call_next(request)
        duration = asyncio.get_event_loop().time() - start_time

        if request.url.path.startswith((api_router.prefix, )):
            logger.info(f"{request.method} - {request.url.path} - {duration:.4f} seconds - {response.status_code}")

        return response

    event_loop = asyncio.new_event_loop()
    asyncio.set_event_loop(event_loop)

    config = uvicorn.Config(
        server_app,
        loop=event_loop,
        host=host,
        port=port,
        log_level="warning",
        timeout_keep_alive=300,
    )

    server = uvicorn.Server(config)
    event_loop.run_until_complete(server.serve())

if __name__ == '__main__':
    main()