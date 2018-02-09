class Boom extends Error {
	constructor (message, statusCode = 500) {
		super(message);
		this.isBoom = true;
		this.statusCode = statusCode;
	}
}

Boom.accepted = message => new Boom(message, 202);
Boom.badRequest = message => new Boom(message, 400);
Boom.unauthorized = message => new Boom(message, 401);

module.exports = Boom;
