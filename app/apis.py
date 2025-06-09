from fastapi import Request, APIRouter, BackgroundTasks
from sse_starlette.sse import EventSourceResponse
from .pubsub import EventPayload, EventHandler
from .models import ResponseMessage
import logging
from typing import List
import asyncio
from pydantic import BaseModel

logger = logging.getLogger(__name__)
api_router = APIRouter(prefix="/api", tags=["api"])

class BulkPublishRequest(BaseModel):
    events: List[EventPayload]
    channel: str = "default"

@api_router.post("/publish")
async def publish_event(event: EventPayload, background_tasks: BackgroundTasks) -> ResponseMessage[bool]:
    background_tasks.add_task(EventHandler.event_handler().publish, event)
    return ResponseMessage[bool](result=True)

@api_router.post("/publish/bulk")
async def publish_bulk_events(request: BulkPublishRequest) -> ResponseMessage[dict]:
    """
    Bulk publish endpoint for high-performance log publishing.
    Can handle thousands of events in a single request.
    """
    try:
        start_time = asyncio.get_event_loop().time()
        
        # Set channel for all events if not already set
        for event in request.events:
            if not event.channel:
                event.channel = request.channel
        
        # Use optimized bulk publish
        await EventHandler.event_handler().publish_bulk(request.events)
        
        end_time = asyncio.get_event_loop().time()
        processing_time = end_time - start_time

        return ResponseMessage[dict](result={
            "published_count": len(request.events),
            "processing_time_ms": round(processing_time * 1000, 2),
            "events_per_second": round(len(request.events) / processing_time, 2) if processing_time > 0 else 0
        })

    except Exception as e:
        logger.error(f"Error in bulk publish: {e}")
        return ResponseMessage[dict](
            result=None,
            error=f"Failed to publish bulk events: {str(e)}"
        )

@api_router.get("/subscribe")
async def event_stream(
    request: Request, 
) -> EventSourceResponse:
    channels: list[str] = request.query_params.getlist("channels")

    async def event_generator():
        try:
            queue = await EventHandler.event_handler().subscribe(channels)

            while True:
                event: EventPayload = await queue.get()

                if isinstance(event, EventPayload):
                    yield event.model_dump_json()

        except Exception as e:
            logger.info(f"Error in event stream: {e}")

        finally:
            await EventHandler.event_handler().unsubscribe(queue)

    return EventSourceResponse(event_generator())
