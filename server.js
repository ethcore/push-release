'use strict';

const config = require('config');
const request = require('request');
const express = require('express');
const bodyParser = require('body-parser');
const keccak256 = require('js-sha3').keccak_256;
const Parity = require('@parity/parity.js');

const transport = new Parity.Api.Transport.Http(`http://localhost:${config.get('rpc.port')}`);
const api = new Parity.Api(transport);

const app = express();
app.use(bodyParser.urlencoded({extended: true}));
module.exports = app;

const reduceObject = (obj, prop) => ({ ...obj, [prop]: true });
const enabledTracks = config.get('enabledTracks').reduce(reduceObject, {});
const supportedPlatforms = config.get('supportedPlatforms').reduce(reduceObject, {});

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

app.post('/push-release/:tag/:commit', handleAsync(async function (req, res) {
	if (keccak256(req.body.secret || '') !== secretHash) {
		throw new Error('Invalid secret');
	}
	const { commit, tag } = req.params;

	console.log(`curl --data "secret=${req.body.secret}" http://localhost:${httpPort}/push-release/${tag}/${commit}`);

	const isCritical = false; // TODO: should take from Git release notes for stable/beta.
	const goodTag = isGoodTag(tag);

	if (!goodTag) {
		throw new Error(`Invalid tag: ${tag}`);
	}

	console.log(`Pushing commit: ${commit} (tag: ${tag}/${goodTag})`);

	const miscBody = await fetchFile(commit, '/util/src/misc.rs');
	const branch = match(
		miscBody,
		/const THIS_TRACK. ..static str = "([a-z]*)";/,
		'Unable to detect track'
	)[1];
	const track = tracks[branch] ? branch : 'testing';
	console.log(`Track: ${branch} => ${track} (${tracks[track]}) [enabled: ${enabledTracks[track]}]`);

	if (!enabledTracks[track]) {
		throw new Error(`Track not enabled: ${track}`);
	}

	let ethereumMod = await fetchFile(commit, '/ethcore/src/ethereum/mod.rs');
	const network = await getNetwork();
	const forkSupported = match(
		ethereumMod,
		`pub const FORK_SUPPORTED_${network.toUpperCase()}: u64 = (\\d+);`,
		'Unable to detect supported fork'
	)[1];

	console.log(`Fork supported: ${forkSupported}`);

	const cargoToml = await fetchFile(commit, '/Cargo.toml');
	const versionMatch = match(
		cargoToml,
		/version = "([0-9]+)\.([0-9]+)\.([0-9]+)"/,
		'Unable to detect version'
	);
	const [major, minor, patch] = versionMatch.slice(1).map(x => parseInt(x, 10));
	const semver = major * 65536 + minor * 256 + patch;

	console.log(`Version: ${versionMatch.join('.')} = ${semver}`);

	const registryAddress = await api.parity.registryAddress();
	console.log(`Registry address: ${registryAddress}`);
	const registry = api.newContract(RegistrarABI, registryAddress);

	const operationsAddress = await registry.instance.getAddress.call({}, [operationsContract, 'A']);
	console.log(`Parity operations address: ${operationsAddress}`);
	console.log(`Registering release: 0x000000000000000000000000${commit}, ${forkSupported}, ${tracks[track]}, ${semver}, ${isCritical}`);
	const hash = await sendTransaction(OperationsABI, operationsAddress, 'addRelease', [`0x000000000000000000000000${commit}`, forkSupported, tracks[track], semver, isCritical]);
	console.log(`Transaction sent with hash: ${hash}`);

	// Return the response
	res.send(`RELEASE: ${commit}/${track}/${branch}/${forkSupported}`);
}));

app.post('/push-build/:tag/:platform', handleAsync(async function (req, res) {
	if (keccak256(req.body.secret || '') !== secretHash) {
		throw new Error('Invalid secret');
	}

	const { tag, platform } = req.params;
	const { commit, filename, sha3 } = req.body;
	console.log(`curl --data "secret=${req.body.secret}&commit=${commit}&filename=${filename}&sha3=${sha3}" http://localhost:${httpPort}/push-build/${tag}/${platform}`);

	const url = `${baseUrl}/${tag}/${platform}/${filename}`;
	const goodTag = isGoodTag(tag);
	const goodPlatform = !!supportedPlatforms[platform];

	const out = `BUILD: ${platform}/${commit} -> ${sha3}/${tag}/${filename}/${goodTag}/${goodPlatform} [${url}]`;
	console.log(out);

	if (sha3 === '' || !goodTag || !goodPlatform) {
		throw new Error(`Invalid sha3 (${sha3}), tag (${tag}) or platform (${platform}).`);
	}

	const body = await fetchFile(commit, '/util/src/misc.rs');
	const branch = match(
		body,
		/const THIS_TRACK. ..static str = "([a-z]*)"/,
		'Unable to detect track'
	)[1];
	const track = tracks[branch] ? branch : 'testing';

	console.log(`Track: ${branch} => ${track} (${tracks[track]}) [enabled: ${!!enabledTracks[track]}]`);

	if (!enabledTracks[track]) {
		throw new Error(`Track not enabled: ${track}`);
	}

	// make sure the node is running
	await getNetwork();

	const registryAddress = await api.parity.registryAddress();
	const reg = api.newContract(RegistrarABI, registryAddress);
	const githubHintAddress = await reg.instance.getAddress.call({}, [githubHint, 'A']);

	console.log(`Registering on GithubHint: ${sha3}, ${url}`);
	const hash = await sendTransaction(GitHubHintABI, githubHintAddress, 'hintURL', [`0x${sha3}`, url]);
	console.log(`Transaction sent with hash: ${hash}`);

	const operationsAddress = await reg.instance.getAddress.call({}, [operationsContract, 'A']);
	console.log(`Registering platform binary: ${commit}, ${platform}, ${sha3}`);
	const hash2 = await sendTransaction(OperationsABI, operationsAddress, 'addChecksum', [`0x000000000000000000000000${commit}`, platform, `0x${sha3}`]);
	console.log(`Transaction sent with hash: ${hash2}`);

	// Respond already
	res.send(out);
}));

function match (string, pattern, comment) {
	const match = string.match(pattern);
	if (!match) {
		throw new Error(`${comment} in ${string}`);
	}

	return match;
}

function handleAsync (asyncFn) {
	return (req, res) => asyncFn(req, res)
		.then(() => {
			if (!res.headersSent) {
				throw new Error('No response from handler');
			}
		})
		.catch(err => {
			console.error(err);
			res.status(400).end(`Error while processing the request:\n${err.message}\n`);
		});
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

function isGoodTag (tag) {
	return tag === 'nightly' || /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag);
}

function sendTransaction (abi, address, method, args) {
	let o = api.newContract(abi, address);
	let tx = {
		from: account.address,
		to: address,
		gasPrice: account.gasPrice,
		data: o.getCallData(o.instance[method], {}, args)
	};
	return account.password === null
		? api.eth.sendTransaction(tx)
		: api.personal.signAndSendTransaction(tx, account.password);
}
