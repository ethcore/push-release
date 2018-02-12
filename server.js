'use strict';

const config = require('config');
const request = require('request');
const express = require('express');
const bodyParser = require('body-parser');
const morganBody = require('morgan-body');
const { celebrate, isCelebrate } = require('celebrate');
const keccak256 = require('js-sha3').keccak_256;
const Parity = require('@parity/parity.js');
const toml = require('toml');

const validate = require('./validation');
const boom = require('./error');

const transport = new Parity.Api.Transport.Http(`http://localhost:${config.get('rpc.port')}`);
const api = new Parity.Api(transport);

const app = express();
// Support health checking by sending HEAD
app.head('/', (req, res) => res.status(200).end());

// Middlewares
app.use(bodyParser.urlencoded({extended: true}));
morganBody(app);

// validate secret for every request
app.use((req, res, next) => {
	if (keccak256(req.body.secret || '') !== secretHash) {
		next(boom.unauthorized('Invalid secret'));
	} else {
		next();
	}
});
module.exports = app;

const reduceObject = (obj, prop) => ({ ...obj, [prop]: true });
const enabledTracks = config.get('enabledTracks').reduce(reduceObject, {});

const account = {
	address: config.get('account.address'),
	password: config.get('account.password'),
	gasPrice: config.get('account.gasPrice')
};

const httpPort = config.get('http.port');
const baseUrl = config.get('assetsBaseUrl');
const secretHash = config.get('secretHash');
const githubRepo = config.get('repository');

const operationsContract = api.util.sha3('parityOperations');
const githubHint = api.util.sha3('githubhint');

const RegistrarABI = require('./res/registrar.json');
const GitHubHintABI = require('./res/githubhint.json');
const OperationsABI = require('./res/operations.json');

const tracks = {
	stable: 1,
	beta: 2,
	nightly: 3,
	master: 3,
	testing: 4
};

const validateRelease = celebrate({
	params: {
		tag: validate.tag,
		commit: validate.commit
	},
	body: {
		secret: validate.secret
	}
});
app.post('/push-release/:tag/:commit', validateRelease, handleAsync(async function (req, res) {
	const { commit, tag } = req.params;

	console.log(`curl --data "secret=${req.body.secret}" http://localhost:${httpPort}/push-release/${tag}/${commit}`);
	console.log(`Pushing commit: ${commit} (tag: ${tag})`);

	const meta = await readParityMetadata(commit);
	const track = tracks[meta.track] ? meta.track : 'testing';
	console.log(`Track: ${meta.track} => ${track} (${tracks[track]}) [enabled: ${enabledTracks[track]}]`);

	if (!enabledTracks[track]) {
		throw boom.accepted(`Track not enabled: ${track}`);
	}

	const network = (await getNetwork()).toLowerCase();
	let forkSupported = parseInt(meta.forks[network], 10);
	if (isNaN(forkSupported)) {
		console.warn(`Invalid fork data for ${network}: '${meta.forks[network]}', assuming 0`);
		forkSupported = 0;
	}

	console.log(`Fork supported: ${forkSupported}`);

	let versionMatch = meta.version.match(/([0-9]+)\.([0-9]+)\.([0-9]+)/);
	if (!versionMatch) {
		throw new Error(`Unable to detect version in ${meta.version}`);
	}
	versionMatch = versionMatch.slice(1);
	const [major, minor, patch] = versionMatch.map(x => parseInt(x, 10));
	const semver = major * 65536 + minor * 256 + patch;

	console.log(`Version: ${versionMatch.join('.')} = ${semver}`);

	const registryAddress = await api.parity.registryAddress();
	const registry = api.newContract(RegistrarABI, registryAddress);

	console.log(`Registering release: 0x000000000000000000000000${commit}, ${forkSupported}, ${tracks[track]}, ${semver}, ${meta.critical}`);

	const operationsAddress = await registry.instance.getAddress.call({}, [operationsContract, 'A']);
	await sendTransaction(OperationsABI, operationsAddress, 'addRelease', [`0x000000000000000000000000${commit}`, forkSupported, tracks[track], semver, meta.critical]);

	// Return the response
	return `RELEASE: ${commit}/${track}/${meta.track}/${forkSupported}`;
}));

const validateBuild = celebrate({
	params: {
		tag: validate.tag,
		platform: validate.platform
	},
	body: {
		secret: validate.secret,
		sha3: validate.sha3,
		filename: validate.filename,
		commit: validate.commit
	}
});
app.post('/push-build/:tag/:platform', validateBuild, handleAsync(async function (req, res) {
	const { tag, platform } = req.params;
	const { commit, filename, sha3 } = req.body;
	console.log(`curl --data "secret=${req.body.secret}&commit=${commit}&filename=${filename}&sha3=${sha3}" http://localhost:${httpPort}/push-build/${tag}/${platform}`);

	const url = `${baseUrl}/${tag}/${platform}/${filename}`;

	const out = `BUILD: ${platform}/${commit} -> ${sha3}/${tag}/${filename} [${url}]`;
	console.log(out);

	const meta = await readParityMetadata(commit);
	const track = tracks[meta.track] ? meta.track : 'testing';
	console.log(`Track: ${meta.track} => ${track} (${tracks[track]}) [enabled: ${!!enabledTracks[track]}]`);

	if (!enabledTracks[track]) {
		throw boom.accepted(`Track not enabled: ${track}`);
	}

	const registryAddress = await api.parity.registryAddress();
	const reg = api.newContract(RegistrarABI, registryAddress);

	console.log(`Registering on GithubHint: ${sha3}, ${url}`);

	const githubHintAddress = await reg.instance.getAddress.call({}, [githubHint, 'A']);
	await sendTransaction(GitHubHintABI, githubHintAddress, 'hintURL', [`0x${sha3}`, url]);

	console.log(`Registering platform binary: ${commit}, ${platform}, ${sha3}`);

	const operationsAddress = await reg.instance.getAddress.call({}, [operationsContract, 'A']);
	await sendTransaction(OperationsABI, operationsAddress, 'addChecksum', [`0x000000000000000000000000${commit}`, platform, `0x${sha3}`]);

	return out;
}));

// make sure that the errors are added at the end
app.use((err, req, res, next) => {
	if (isCelebrate(err)) {
		const fields = err.details.map(x => x.path && x.path.join ? x.path.join('.') : x.path);
		if (fields.indexOf('platform') !== -1 || fields.indexOf('tag') !== -1) {
			res.status(202).send(err.message);
		} else {
			res.status(400).send(err.message);
		}
		return;
	}

	if (err.isBoom) {
		res.status(err.statusCode).send(err.message);
		return;
	}

	console.error(err);
	return res.status(500).send(err.message);
});

function handleAsync (asyncFn) {
	return (req, res, next) => asyncFn(req, res)
		.then(result => {
			return res.send(result);
		})
		.catch(err => {
			console.error(err);
			next(err);
		});
}

async function readParityMetadata (commit) {
	try {
		const metaFile = await fetchFile(commit, '/util/version/Cargo.toml');
		const parsed = toml.parse(metaFile);

		return {
			version: parsed.package.version,
			critical: parsed.package.critical || false,
			...parsed.package.metadata
		};
	} catch (err) {
		throw new Error(`Unable to parse Parity metadata: ${err.message}`);
	}
}

function fetchFile (commit, path) {
	return new Promise((resolve, reject) => {
		request.get({
			headers: {
				'User-Agent': githubRepo
			},
			url: `https://raw.githubusercontent.com/${githubRepo}/${commit}${path}`
		}, function (error, response, body) {
			if (error) {
				reject(error);
			} else {
				resolve(body);
			}
		});
	});
}

async function getNetwork () {
	const n = await api.parity.netChain();
	const network = (n === 'homestead' || n === 'mainnet' || n === 'foundation' ? 'foundation' : n.indexOf('kovan.json') !== -1 ? 'kovan' : n);
	console.log(`On network ${network}`);
	return network;
}

function sendTransaction (abi, address, method, args) {
	let o = api.newContract(abi, address);
	let tx = {
		from: account.address,
		to: address,
		gasPrice: account.gasPrice,
		data: o.getCallData(o.instance[method], {}, args)
	};
	console.log('Sending transaction: ', tx);

	const hash = account.password === null
		? api.eth.sendTransaction(tx)
		: api.personal.signAndSendTransaction(tx, account.password);

	console.log(`Transaction sent with hash: ${hash}`);
	return hash;
}
