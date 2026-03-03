# NanoClaw Agent Container
# Runs Gemini AI in isolated Linux VM via @google/generative-ai SDK

FROM node:22-slim

# Prefer IPv4 DNS (required for Apple Container vmnet NAT to work)
ENV NODE_OPTIONS=--dns-result-order=ipv4first

# Create app directory
WORKDIR /app

# Copy the source files
COPY agent-runner/package*.json ./
COPY agent-runner/src/ ./src/
COPY agent-runner/tsconfig.json ./

# Install dependencies during build
RUN npm install

# Install system utilities needed by agent bash scripts
RUN apt-get update && apt-get install -y --no-install-recommends jq curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Add MCP/Agent-Browser shims
RUN printf '#!/bin/bash\nMESSAGE="$1"\nif [ "$1" == "--message" ]; then MESSAGE="$2"; fi\nif [ -z "$MESSAGE" ]; then MESSAGE=$(cat); fi\nFILENAME="/workspace/ipc/messages/msg_$(date +%%s)_$RANDOM.json"\necho "{\\"type\\": \\"message\\", \\"chatJid\\": \\"$CHAT_JID\\", \\"text\\": \\"$MESSAGE\\"}" > "$FILENAME"\n' > /usr/local/bin/mcp__nanoclaw__send_message && chmod +x /usr/local/bin/mcp__nanoclaw__send_message
RUN printf '#!/bin/bash\nCOMMAND="$1"\nURL="$2"\nif [ "$COMMAND" == "open" ]; then curl -v -L "$URL"; elif [ "$COMMAND" == "search" ]; then curl -v -L "https://www.google.com/search?q=$(echo $2 | jq -sRr @uri)"; else curl -v -L "$@"; fi\n' > /usr/local/bin/agent-browser && chmod +x /usr/local/bin/agent-browser

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
# Note: entrypoint still tries to run npx tsc to allow JIT tool customization
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
