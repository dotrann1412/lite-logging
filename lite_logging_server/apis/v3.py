from fastapi import Request, APIRouter, BackgroundTasks, Request, responses
from sse_starlette.sse import EventSourceResponse
import logging
from lite_logging.pubsub.v2 import WQueue, EventHandler

_handler = EventHandler[bytes]()

async def publish(channels: list[str] | set[str], event: bytes):
    global _handler
    return await _handler.publish(channels, event)

async def subscribe(client_id: str, channels: list[str] = []) -> WQueue:
    global _handler
    return await _handler.subscribe(client_id, channels)

async def unsubscribe(client_id: str):
    global _handler
    return await _handler.unsubscribe(client_id)

logger = logging.getLogger(__name__)
api_router = APIRouter(tags=["v3"])

@api_router.post("/publish")
async def publish_event(event: Request, background_tasks: BackgroundTasks) -> responses.Response:
    channels = event.query_params.getlist("channels")
    background_tasks.add_task(publish, channels, await event.body())
    return responses.Response(status_code=200)

@api_router.get("/subscribe")
async def event_stream(request: Request) -> EventSourceResponse:

    client_id = f"{request.client.host}:{request.client.port}"
    channels: list[str] = request.query_params.getlist("channels")

    async def event_generator():
        try:
            queue = await subscribe(client_id, channels)

            while True:
                event: bytes = await queue.get()

                if isinstance(event, bytes):
                    yield event.hex()

        except Exception as e:
            logger.info(f"Error in event stream: {e}")

        finally:
            await unsubscribe(client_id)

    return EventSourceResponse(event_generator())
