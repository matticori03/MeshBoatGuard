# Node-RED image with the nodes required by the MeshBoatGuard flows.
# Needed because the official entrypoint does not install anything from /data/package.json:
# without this, every new device would require a manual npm install.
FROM nodered/node-red:latest

# mqtt in/out are already included in the Node-RED core, no package to install.
# telegrambot -> "telegram bot/receiver/sender" nodes (notifications and commands)
RUN npm install --no-audit --no-fund \
    node-red-contrib-telegrambot
