#!/bin/bash

# use curl to publish a message to the channel
curl -X POST -H "Content-Type: application/json" -d '
{
    "data": {
        "data": "Hello, world!",
        "type": "text",
        "tags": ["test"]
    },
    "channel": "default",
    "type": "message"
}' http://14.225.217.119/api/publish