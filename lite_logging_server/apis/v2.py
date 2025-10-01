from fastapi import Request, APIRouter, BackgroundTasks, responses
from sse_starlette.sse import EventSourceResponse
from lite_logging.pubsub.v2 import EventPayload, EventHandler, WQueue
import logging
from dataclasses import asdict
import json

logger = logging.getLogger(__name__)
api_router = APIRouter(tags=["v2"])

_handler = EventHandler[EventPayload]()

async def publish(channels: list[str] | set[str], event: EventPayload):
    global _handler
    return await _handler.publish(channels, event)

async def subscribe(client_id: str, channels: list[str] = []) -> WQueue:
    global _handler
    return await _handler.subscribe(client_id, channels)

async def unsubscribe(client_id: str):
    global _handler
    return await _handler.unsubscribe(client_id)

@api_router.post("/publish")
async def publish_event(request: Request, background_tasks: BackgroundTasks) -> responses.Response:
    channels = request.query_params.getlist("channels")
    background_tasks.add_task(publish, channels, await request.json())
    return responses.Response(status_code=200)

@api_router.get("/subscribe")
async def event_stream(
    request: Request, 
) -> EventSourceResponse:
    client_id = f"{request.client.host}:{request.client.port}"
    channels: list[str] = request.query_params.getlist("channels")
    
    async def event_generator():
        try:
            queue = await subscribe(client_id, channels)

            while True:
                event: EventPayload | dict = await queue.get()
                yield json.dumps(
                    asdict(event) if isinstance(event, EventPayload) 
                    else event
                )

        except Exception as e:
            logger.info(f"Error in event stream: {e}")

        finally:
            await unsubscribe(client_id)

    return EventSourceResponse(event_generator())
