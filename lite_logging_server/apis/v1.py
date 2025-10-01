from fastapi import Request, APIRouter, BackgroundTasks, responses
from sse_starlette.sse import EventSourceResponse
from lite_logging.pubsub.v1 import EventPayload, EventHandler
import logging
from typing import List
from dataclasses import dataclass, field, asdict
import json

logger = logging.getLogger(__name__)
api_router = APIRouter(tags=["v1"])

handler = EventHandler()

@dataclass
class BulkPublishRequest:
    events: List[EventPayload] = field(default_factory=list)
    channel: str = "default"

@api_router.post("/publish")
async def publish_event(event: EventPayload, background_tasks: BackgroundTasks) -> responses.Response:
    background_tasks.add_task(handler.publish, event)
    return responses.Response(status_code=200)

@api_router.post("/publish/bulk")
async def publish_bulk_events(request: BulkPublishRequest) -> responses.Response:
    """
    Bulk publish endpoint for high-performance log publishing.
    Can handle thousands of events in a single request.
    """
    try:
        for event in request.events:
            if not event.channel:
                event.channel = request.channel
        await handler.publish_bulk(request.events)
        return responses.Response(status_code=200)
    except Exception as e:
        logger.error(f"Error in bulk publish: {e}")
        return responses.Response(status_code=500)

@api_router.get("/subscribe")
async def event_stream(
    request: Request, 
) -> EventSourceResponse:
    channels: list[str] = request.query_params.getlist("channels")
    client_id = f"{request.client.host}:{request.client.port}"

    async def event_generator():
        try:
            queue = await handler.subscribe(client_id, channels)

            while True:
                event: EventPayload = await queue.get()

                if isinstance(event, EventPayload):
                    yield json.dumps(asdict(event))

        except Exception as e:
            logger.info(f"Error in event stream: {e}")

        finally:
            await handler.unsubscribe(queue)

    return EventSourceResponse(event_generator())
