#!/bin/bash
# Wait for Next.js to be ready
sleep 10
# Start ONVIF queue polling
wget -q -O- "http://localhost:10001/api/queue/poll?start=1&interval=8000" > /dev/null 2>&1
echo "[$(date)] Queue polling started"
