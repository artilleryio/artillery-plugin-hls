const HLSServer = require('hls-server');
const http = require('http');
const path = require('path');

const server = http.createServer():
const hls = new HLSServer(server, {
  path: '/streams',
  dir: path.resolve(__dirname, 'videos')
});
server.listen(process.env.PORT || 10888);
