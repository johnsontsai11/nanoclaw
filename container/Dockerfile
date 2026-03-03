# NanoClaw Agent Container
# Runs Gemini AI in isolated Linux VM via @google/generative-ai SDK

FROM node:22-slim

# Prefer IPv4 DNS (required for Apple Container vmnet NAT to work)
ENV NODE_OPTIONS=--dns-result-order=ipv4first

# Create app directory
WORKDIR /app

# Copy the entire agent-runner (including pre-built node_modules and dist)
# This avoids needing internet access during the build process
COPY agent-runner/ ./

# Install system utilities needed by agent bash scripts
RUN apt-get update && apt-get install -y --no-install-recommends jq && rm -rf /var/lib/apt/lists/*

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
