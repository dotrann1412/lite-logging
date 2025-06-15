#!/bin/bash

# Function to escape plain text for JSON string
escape_for_json_string() {
    local input="$1"
    # Escape backslashes first
    input=$(echo "$input" | sed 's/\\/\\\\/g')
    # Escape double quotes
    input=$(echo "$input" | sed 's/"/\\"/g')
    # Escape newlines for JSON string
    input=$(echo "$input" | sed ':a;N;$!ba;s/\n/\\n/g')
    
    echo "$input"
}

# Collect container info
logs=$(podman ps -a)
stats=$(podman stats --no-stream)
hostname=$(hostname)
count_users=$(podman ps -a | grep proxy | wc -l)

escaped_logs=$(escape_for_json_string "$logs")
escaped_stats=$(escape_for_json_string "$stats")
escaped_count_users=$(escape_for_json_string "$count_users")

timeout_seconds=1

# Send logs
curl -X POST -H "Content-Type: application/json" -d "{
    \"data\": {
        \"data\": \"$escaped_logs\",
        \"type\": \"text\",
        \"tags\": [\"crypto-agents\", \"containers\", \"$hostname\"]
    },
    \"channel\": \"crypto-agents\",
    \"type\": \"message\"
}" http://14.225.217.119/api/publish --max-time $timeout_seconds

# Send stats
curl -X POST -H "Content-Type: application/json" -d "{
    \"data\": {
        \"data\": \"$escaped_stats\",
        \"type\": \"text\",
        \"tags\": [\"crypto-agents\", \"stats\", \"$hostname\"]
    },
    \"channel\": \"crypto-agents\",
    \"type\": \"message\"
}" http://14.225.217.119/api/publish --max-time $timeout_seconds

# Send count of users
curl -X POST -H "Content-Type: application/json" -d "{
    \"data\": {
        \"data\": \"$escaped_count_users\",
        \"type\": \"text\",
        \"tags\": [\"crypto-agents\", \"users\", \"$hostname\"]
    },
    \"channel\": \"crypto-agents\",
    \"type\": \"message\"
}" http://14.225.217.119/api/publish --max-time $timeout_seconds