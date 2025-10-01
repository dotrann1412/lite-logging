import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Union, Optional
from enum import Enum
import os

class WQueue(asyncio.Queue):
    def __init__(self, queue_id: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._id = queue_id

class EventType(str, Enum):
    """Enum for event types"""
    MESSAGE = "message"
    ERROR = "error"
    INFO = "info"

@dataclass
class EventPayload:
    id: str = field(default_factory=lambda: os.urandom(6).hex())
    type: EventType = EventType.MESSAGE
    data: dict = field(default_factory=dict)
    channel: Optional[str] = None

class EventHandler:
    DEFAULT_CHANNEL = 'default'

    def __init__(self):
        self.subscribers: dict[str, WQueue] = {}

    async def subscribe(self, client_id: str | None = None, channels: list[str] = []) -> WQueue:
        """Subscribe a new client to the event stream"""
        queue: WQueue = WQueue(client_id or uuid.uuid4().hex)

        if not channels:
            channels = [self.DEFAULT_CHANNEL]

        for c in channels:
            self.subscribers[c + queue._id] = queue

        return queue

    async def unsubscribe(self, queue: Union[str, WQueue]):
        """Unsubscribe a client from the event stream"""
        client_id = queue if isinstance(queue, str) else queue._id

        for k in list(self.subscribers.keys()):
            if k.endswith(client_id):
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
