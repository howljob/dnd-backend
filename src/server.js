const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { initializeTabletopWebSocketServer } = require('./modules/tabletop/tabletop.ws');

const server = http.createServer(app);

initializeTabletopWebSocketServer(server);

server.listen(env.port, () => {
  console.log(`DND backend running on http://localhost:${env.port}`);
});
