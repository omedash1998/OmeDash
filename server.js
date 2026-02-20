const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const config = require('./src/config');
const socketHandler = require('./src/sockets/socketHandler');

// Serve frontend static files
app.use(express.static("public"));

// Initialize socket event handlers
socketHandler(io);

server.listen(config.PORT, () => {
  console.log(`Server running at http://localhost:${config.PORT}`);
});
