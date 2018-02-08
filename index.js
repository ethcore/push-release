const config = require('config');
const httpPort = config.get('http.port');
const app = require('./server');

const server = app.listen(httpPort, function () {
	const host = server.address().address;
	const port = server.address().port;
	console.log('push-release service listening at http://%s:%s', host, port);
});
