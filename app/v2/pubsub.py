import asyncio
from typing import Union, TypeVar, Generic
from dataclasses import dataclass, field

T = TypeVar('T')

class WQueue(asyncio.Queue):
    def __init__(self, _id: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._id = _id

@dataclass
class EventPayload:
    payload: Union[dict, str] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)

class EventHandler(Generic[T]):
    def __init__(self):
        self.subscribers: dict[str, WQueue] = {}
        self.ids_by_subscribers: dict[str, set[str]] = {}
        self.ids_by_channels: dict[str, set[str]] = {}

    async def subscribe(self, _id, channels: list[str] = []) -> WQueue:
        queue: WQueue = WQueue(_id)
        ids = set()
        channels = set(channels)

        for c in channels:
            composed_id = c + queue._id
            ids.add(composed_id)
            self.subscribers[composed_id] = queue
            self.ids_by_channels[c].add(composed_id)

        self.ids_by_subscribers[queue._id] = ids
        return queue

    async def unsubscribe(self, _id: str):
        ids = self.ids_by_subscribers.pop(_id, [])
        l_id = len(_id)

        for k in ids:
            channel = k[-l_id:]
            self.subscribers.pop(k, None)
            self.ids_by_channels[channel].remove(k)

    async def publish(self, channels: list[str] | set[str], event: T):
        """Publish an event to all subscribers"""

        for c in channels:
            for v in self.ids_by_channels.get(c, []):
                await v.put(event)
