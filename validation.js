const config = require('config');
const { Joi } = require('celebrate');

const secretHash = config.get('secretHash');
const commit = Joi.string().hex().length(40).required();
const filename = Joi.string().min(3).required();
const platform = Joi.valid(config.get('supportedPlatforms')).required();
const secret = Joi.string().min(3).required();
const sha3 = Joi.string().hex().length(64).required();
const tag = Joi.string().allow('nightly').regex(/^v[0-9]+\.[0-9]+\.[0-9]+$/).required();

module.exports = {
	commit,
	filename,
	platform,
	secret,
	sha3,
	tag,
}
