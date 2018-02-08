class Boom extends Error {
	constructor(message, statusCode = 500) {
		super(message);
		this.isBoom = true;
		this.statusCode = statusCode;
	}
}

Boom.unauthorized = (message) => new Boom(message, 401);
Boom.accepted = (message) => new Boom(message, 202);

module.exports = Boom;
