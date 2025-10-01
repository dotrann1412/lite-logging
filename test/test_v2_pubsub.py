from lite_logging.pubsub.v2 import EventHandler, EventPayload
import asyncio

async def test_subscribe():
    handler = EventHandler[EventPayload]()

    test_id = "test_id"
    test_channel = "test_channel"

    queue = await handler.subscribe(test_id,channels=[test_channel])

    assert queue is not None and queue._id == test_id, queue
    assert any(k.endswith(queue._id) for k in handler.subscribers.keys()), handler.subscribers
    assert queue._id in handler.ids_by_subscribers, handler.ids_by_subscribers
    assert test_channel in handler.ids_by_channels and f'{test_channel}{test_id}' in handler.ids_by_channels[test_channel], handler.ids_by_channels[test_channel]

async def test_unsubscribe():
    handler = EventHandler[EventPayload]()

    test_id = "test_id"
    test_channel = "test_channel"

    queue = await handler.subscribe(test_id,channels=[test_channel])

    assert queue is not None and queue._id == test_id, queue
    assert any(k.endswith(queue._id) for k in handler.subscribers.keys())
    assert queue._id in handler.ids_by_subscribers, handler.ids_by_subscribers
    assert test_channel in handler.ids_by_channels and f'{test_channel}{test_id}' in handler.ids_by_channels[test_channel], handler.ids_by_channels[test_channel]
    await handler.unsubscribe(queue._id)
    assert all(not k.endswith(queue._id) for k in handler.subscribers.keys())
    assert queue._id not in handler.ids_by_subscribers
    assert "test" not in handler.ids_by_channels or queue._id not in handler.ids_by_channels["test"]

async def test_publish():
    handler = EventHandler[EventPayload]()
    test_id = "test_id"
    test_channel = "test_channel"

    queue = await handler.subscribe(test_id, channels=[test_channel])
    sample_event = EventPayload(payload={"message": "test"}, tags=["test"])
    await handler.publish([test_channel], sample_event)
    received: EventPayload = await queue.get()
    assert received is not None and isinstance(received, EventPayload)
    assert received.payload == sample_event.payload
    
    handler = EventHandler[bytes]()
    queue = await handler.subscribe(test_id, channels=[test_channel])
    sample_event = b"test"
    await handler.publish([test_channel], sample_event)
    received: bytes = await queue.get()
    assert received is not None and isinstance(received, bytes)
    assert received == sample_event
    
async def main():
    await test_subscribe()
    await test_unsubscribe()
    await test_publish()

if __name__ == "__main__":
    asyncio.run(main())