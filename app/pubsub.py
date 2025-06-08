import asyncio
import uuid
from typing import Union, Optional
from pydantic import BaseModel, Field
from enum import Enum
from functools import lru_cache
from .utils import random_payload

class WQueue(asyncio.Queue):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._id = uuid.uuid4().hex

class EventType(str, Enum):
    """Enum for event types"""
    MESSAGE = "message"
    ERROR = "error"
    INFO = "info"

class EventPayload(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: EventType = EventType.MESSAGE
    data: dict
    channel: Optional[str] = None

class EventHandler:
    DEFAULT_CHANNEL = random_payload(6)

    def __init__(self):
        self.subscribers: dict[str, WQueue] = {}

    async def subscribe(self, channels: list[str] = []) -> WQueue:
        """Subscribe a new client to the event stream"""
        queue: WQueue = WQueue()

        if not channels:
            channels = [self.DEFAULT_CHANNEL]

        for c in channels:
            self.subscribers[c + queue._id] = queue

        return queue

    async def unsubscribe(self, queue: Union[str, WQueue]):
        """Unsubscribe a client from the event stream"""
        _id = queue if isinstance(queue, str) else queue._id

        for k in list(self.subscribers.keys()):
            if k.endswith(_id):
                self.subscribers.pop(k, None)

    async def publish(self, event: EventPayload):
        """Publish an event to all subscribers"""

        if not event.channel:
            event.channel = self.DEFAULT_CHANNEL

        # Collect matching queues first to avoid holding lock during put operations
        matching_queues = []
        for k, v in self.subscribers.items():
            if k.startswith(event.channel):
                matching_queues.append(v)

        # Publish to all matching queues concurrently
        if matching_queues:
            await asyncio.gather(*[queue.put(event) for queue in matching_queues], return_exceptions=True)

    async def publish_bulk(self, events: list[EventPayload]):
        """
        Optimized bulk publish for high performance.
        Groups events by channel and publishes them efficiently.
        """
        if not events:
            return

        # Group events by channel for efficient processing
        events_by_channel = {}
        for event in events:
            if not event.channel:
                event.channel = self.DEFAULT_CHANNEL
            
            if event.channel not in events_by_channel:
                events_by_channel[event.channel] = []

            events_by_channel[event.channel].append(event)

        # Collect all subscriber queues grouped by channel
        channel_subscribers = {}
        for channel in events_by_channel.keys():
            channel_subscribers[channel] = []
            for k, v in self.subscribers.items():
                if k.startswith(channel):
                    channel_subscribers[channel].append(v)

        # Publish all events for each channel concurrently
        publish_tasks = []
        for channel, channel_events in events_by_channel.items():
            queues = channel_subscribers.get(channel, [])
            if queues:
                # For each queue, add all events for this channel
                for queue in queues:
                    for event in channel_events:
                        publish_tasks.append(queue.put(event))

        # Execute all put operations concurrently
        if publish_tasks:
            await asyncio.gather(*publish_tasks, return_exceptions=True)

    @lru_cache(maxsize=1)
    @staticmethod
    def event_handler() -> 'EventHandler':
        return EventHandler()
