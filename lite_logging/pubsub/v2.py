import asyncio
from typing import Union, TypeVar, Generic, Literal
from dataclasses import dataclass, field, fields

T = TypeVar('T')

class WQueue(asyncio.Queue):
    def __init__(self, queue_id: str, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._id = queue_id

@dataclass
class EventPayload:
    payload: Union[dict, str] = ""
    tags: list[str] = field(default_factory=list)

    def __init__(self, payload: Union[dict, str] = "", tags: list[str] = [], **kwargs) -> None:
        self.payload = payload
        self.tags = tags

        for f in fields(self):
            if f.name in kwargs:
                setattr(self, f.name, kwargs[f.name])

class EventHandler(Generic[T]):
    def __init__(self):
        self.subscribers: dict[str, WQueue] = {}
        self.ids_by_subscribers: dict[str, set[str]] = {}
        self.ids_by_channels: dict[str, set[str]] = {}

    async def subscribe(self, cient_id: str, channels: list[str] = []) -> WQueue:
        queue: WQueue = WQueue(cient_id)
        ids = set()
        channels = set(channels)

        for c in channels:
            composed_id = c + queue._id
            ids.add(composed_id)
            self.subscribers[composed_id] = queue

            if c not in self.ids_by_channels:
                self.ids_by_channels[c] = set()

            self.ids_by_channels[c].add(composed_id)

        self.ids_by_subscribers[queue._id] = ids
        return queue

    async def unsubscribe(self, client_id: str):
        ids = self.ids_by_subscribers.pop(client_id, [])
        l_id = len(client_id)

        for k in ids:
            channel = k[:-l_id]
            self.subscribers.pop(k, None)
            self.ids_by_channels[channel].remove(k)

    async def publish(self, channels: list[str] | set[str], event: T):
        """Publish an event to all subscribers"""

        for c in channels:
            for v in self.ids_by_channels.get(c, []):
                await self.subscribers[v].put(event)
