const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { attachTabletopWs } = require('./modules/tabletop/tabletop.ws');

const server = http.createServer(app);
attachTabletopWs(server);

server.listen(env.port, () => {
  console.log(`DND backend running on http://localhost:${env.port}`);
});
