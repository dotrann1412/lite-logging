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

async def subscribe(_id: str, channels: list[str] = []) -> WQueue:
    global _handler
    return await _handler.subscribe(_id, channels)

async def unsubscribe(_id: str):
    global _handler
    return await _handler.unsubscribe(_id)

@api_router.post("/publish")
async def publish_event(request: Request, event: EventPayload, background_tasks: BackgroundTasks) -> responses.Response:
    channels = request.query_params.getlist("channels")
    background_tasks.add_task(publish, channels, event)
    return responses.Response(status_code=200)

@api_router.get("/subscribe")
async def event_stream(
    request: Request, 
) -> EventSourceResponse:
    _id = f"{request.client.host}:{request.client.port}"
    channels: list[str] = request.query_params.getlist("channels")

    async def event_generator():
        try:
            queue = await subscribe(_id, channels)

            while True:
                event: EventPayload = await queue.get()

                if isinstance(event, EventPayload):
                    yield json.dumps(asdict(event))

        except Exception as e:
            logger.info(f"Error in event stream: {e}")

        finally:
            await unsubscribe(_id)

    return EventSourceResponse(event_generator())
