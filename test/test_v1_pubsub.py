from lite_logging.pubsub.v1 import EventHandler, EventPayload
import asyncio

async def test_subscribe():
    handler = EventHandler()
    queue = await handler.subscribe(channels=["test"])
    assert queue is not None
    assert any(k.endswith(queue._id) for k in handler.subscribers.keys())

async def test_unsubscribe():
    handler = EventHandler()
    queue = await handler.subscribe(channels=["test"])
    assert any(k.endswith(queue._id) for k in handler.subscribers.keys())
    await handler.unsubscribe(queue)
    assert all(not k.endswith(queue._id) for k in handler.subscribers.keys())

async def test_publish():
    handler = EventHandler()
    queue = await handler.subscribe(channels=["test"])
    sample_event = EventPayload(data={"message": "test"}, channel="test")
    await handler.publish(sample_event)
    received = await queue.get()
    assert received is not None
    assert received.data == sample_event.data

async def main():
    await test_subscribe()
    await test_unsubscribe()
    await test_publish()

if __name__ == "__main__":
    asyncio.run(main())