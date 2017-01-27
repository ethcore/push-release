'use strict';

const Parity = require('@parity/parity.js');
const transport = new Parity.Api.Transport.Http('http://localhost:8545');
const api = new Parity.Api(transport);
var request = require('request');
var express = require('express');
var bodyParser = require('body-parser');
var keccak_256 = require('js-sha3').keccak_256;

var app = express();
app.use(bodyParser.urlencoded({extended:true}));

const tracks = {
	stable: 1,
	beta: 2,
	nightly: 3,
	master: 3,
	testing: 4
};

const enabled = {
    stable: true,
    beta: true
};

const account = {
  address: process.env.ETH_ACCOUNT_ADDRESS,
  password: process.env.ETH_ACCOUNT_PASSWORD || null
};
const baseUrl = process.env.ASSETS_BASE_URL;
const tokenHash = process.env.TOKEN_HASH;

var network;
api.parity.netChain().then(n => { network = (n == 'homestead' || n == 'mainnet' ? 'frontier' : n); });

function sendTransaction(abi, address, method, args) {
	let o = api.newContract(abi, address);
	let tx = {
		from: account.address,
		to: address,
		data: o.getCallData(o.instance[method], {}, args)
	};
	return account.password === null ?
		api.eth.sendTransaction(tx) :
		api.personal.signAndSendTransaction(tx, account.password)
}
/*
function sendTransaction(abi, address, method, args) {
	let o = api.newContract(abi, address);
	return api.parity.postTransaction({
		from: account.address,
		to: address,
		data: o.getCallData(o.instance[method], {}, args)
	});
}
*/
app.post('/push-release/:branch/:commit', function (req, res) {
	if (keccak_256(req.body.secret) != tokenHash)
		res.end("Bad request.");

	let commit = req.params.commit;
	let isCritical = false;		// TODO: should take from Git release notes for stable/beta.

	var out;
	console.log(`Pushing commit: ${commit}`);

	request.get({headers: { 'User-Agent': 'ethcore/parity' }, url: `https://raw.githubusercontent.com/ethcore/parity/${commit}/util/src/misc.rs`}, function (error, response, body) {
		let branch = body.match(`const THIS_TRACK. ..static str = "([a-z]*)";`)[1];
		let track = tracks[branch] ? branch : 'testing';
		console.log(`Track: ${branch} => ${track} (${tracks[track]}) [enabled: ${enabled[track]}]`);

		if (enabled[track]) {

			request.get({headers: { 'User-Agent': 'ethcore/parity' }, url: `https://raw.githubusercontent.com/ethcore/parity/${commit}/ethcore/src/ethereum/mod.rs`}, function (error, response, body) {
				let pattern = `pub const FORK_SUPPORTED_${network.toUpperCase()}: u64 = (\\d+);`;
				let m = body.match(pattern);
				if (m === null) {
					console.log(`Unable to detect supported fork with pattern: ${pattern}.`);
					return;
				}
				let forkSupported = m[1];

				out = `RELEASE: ${commit}/${track}/${branch}/${forkSupported}`;
			   	console.log(`Fork supported: ${forkSupported}`);

				request.get({headers: { 'User-Agent': 'ethcore/parity' }, url: `https://raw.githubusercontent.com/ethcore/parity/${commit}/Cargo.toml`}, function (error, response, body) {
					let version = body.match(/version = "([0-9]+)\.([0-9]+)\.([0-9]+)"/).slice(1);
					let semver = +version[0] * 65536 + +version[1] * 256 + +version[2];

					api.parity.registryAddress().then(a =>
						api.newContract(RegistrarABI, a).instance.getAddress.call({}, [api.util.sha3(process.env.OPERATIONS_CONTRACT_NAME), 'A'])
					).then(a => {
						console.log(`Registering release: 0x000000000000000000000000${commit}, ${forkSupported}, ${tracks[track]}, ${semver}, ${isCritical}`);
						// Should be this...
		//				api.newContract(OperationsABI, a).instance.addRelease.postTransaction({from: account.address}, [`0x000000000000000000000000${commit}`, forkSupported, tracks[track], semver, isCritical])
						// ...but will have to be this for now...
						return sendTransaction(OperationsABI, a, 'addRelease', [`0x000000000000000000000000${commit}`, forkSupported, tracks[track], semver, isCritical]);
					}).then(h => {
						console.log(`Transaction sent with hash: ${h}`);
					});
				})
			})
		}
	})

	res.end(out);
})

app.post('/push-build/:branch/:platform', function (req, res) {
	if (keccak_256(req.body.secret) != tokenHash)
		res.end("Bad request.");

	let platform = req.params.platform;
	let commit = req.body.commit;
	let filename = req.body.filename;
	let sha3 = req.body.sha3;
	let url = `${baseUrl}/${platform}/${filename}`;

	let out = `BUILD: ${platform}/${commit} -> ${sha3}/${filename} [${url}]`;
	console.log(out);

	var reg;
	api.parity.registryAddress().then(a => {
		reg = api.newContract(RegistrarABI, a);
		return reg.instance.getAddress.call({}, [api.util.sha3('githubhint'), 'A']);
	}).then(g => {
		console.log(`Registering on GithubHint: ${sha3}, ${url}`);
		// Should be this...
//		api.newContract(GitHubHintABI, g).instance.hintURL.postTransaction({from: account.address}, [`0x${sha3}`, url]).then(() => {
		// ...but will have to be this for now...
		return sendTransaction(GitHubHintABI, g, 'hintURL', [`0x${sha3}`, url]);
	}).then(h => {
		console.log(`Transaction sent with hash: ${h}`);

		return reg.instance.getAddress.call({}, [api.util.sha3('parityoperations'), 'A']);
	}).then(o => {
		console.log(`Registering platform binary: ${commit}, ${platform}, ${sha3}`);
		// Should be this...
//		return api.newContract(OperationsABI, o).instance.addChecksum.postTransaction({from: account.address}, [`0x000000000000000000000000${commit}`, platform, `0x${sha3}`]);
		// ...but will have to be this for now...
		return sendTransaction(OperationsABI, o, 'addChecksum', [`0x000000000000000000000000${commit}`, platform, `0x${sha3}`]);
	}).then(h => {
		console.log(`Transaction sent with hash: ${h}`);
	});

	res.end(out);
})

var server = app.listen(process.env.HTTP_PORT, function () {
	var host = server.address().address;
	var port = server.address().port;
	console.log("push-release service listening at http://%s:%s", host, port);
});

const RegistrarABI = [{"constant":false,"inputs":[{"name":"_new","type":"address"}],"name":"setOwner","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_name","type":"string"}],"name":"confirmReverse","outputs":[{"name":"success","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_name","type":"bytes32"}],"name":"reserve","outputs":[{"name":"success","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_name","type":"bytes32"},{"name":"_key","type":"string"},{"name":"_value","type":"bytes32"}],"name":"set","outputs":[{"name":"success","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_name","type":"bytes32"}],"name":"drop","outputs":[{"name":"success","type":"bool"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_name","type":"bytes32"},{"name":"_key","type":"string"}],"name":"getAddress","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_amount","type":"uint256"}],"name":"setFee","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_name","type":"bytes32"},{"name":"_to","type":"address"}],"name":"transfer","outputs":[{"name":"success","type":"bool"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"owner","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_name","type":"bytes32"}],"name":"reserved","outputs":[{"name":"reserved","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"drain","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_name","type":"string"},{"name":"_who","type":"address"}],"name":"proposeReverse","outputs":[{"name":"success","type":"bool"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_name","type":"bytes32"},{"name":"_key","type":"string"}],"name":"getUint","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_name","type":"bytes32"},{"name":"_key","type":"string"}],"name":"get","outputs":[{"name":"","type":"bytes32"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"fee","outputs":[{"name":"","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_name","type":"bytes32"}],"name":"getOwner","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"reverse","outputs":[{"name":"","type":"string"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_name","type":"bytes32"},{"name":"_key","type":"string"},{"name":"_value","type":"uint256"}],"name":"setUint","outputs":[{"name":"success","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"removeReverse","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_name","type":"bytes32"},{"name":"_key","type":"string"},{"name":"_value","type":"address"}],"name":"setAddress","outputs":[{"name":"success","type":"bool"}],"payable":false,"type":"function"},{"anonymous":false,"inputs":[{"indexed":false,"name":"amount","type":"uint256"}],"name":"Drained","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"amount","type":"uint256"}],"name":"FeeChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"name","type":"bytes32"},{"indexed":true,"name":"owner","type":"address"}],"name":"Reserved","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"name","type":"bytes32"},{"indexed":true,"name":"oldOwner","type":"address"},{"indexed":true,"name":"newOwner","type":"address"}],"name":"Transferred","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"name","type":"bytes32"},{"indexed":true,"name":"owner","type":"address"}],"name":"Dropped","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"name","type":"bytes32"},{"indexed":true,"name":"owner","type":"address"},{"indexed":true,"name":"key","type":"string"},{"indexed":false,"name":"plainKey","type":"string"}],"name":"DataChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"name","type":"string"},{"indexed":true,"name":"reverse","type":"address"}],"name":"ReverseProposed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"name","type":"string"},{"indexed":true,"name":"reverse","type":"address"}],"name":"ReverseConfirmed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"name","type":"string"},{"indexed":true,"name":"reverse","type":"address"}],"name":"ReverseRemoved","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"old","type":"address"},{"indexed":true,"name":"current","type":"address"}],"name":"NewOwner","type":"event"}];
const GitHubHintABI = [{"constant":false,"inputs":[{"name":"_content","type":"bytes32"},{"name":"_url","type":"string"}],"name":"hintURL","outputs":[],"type":"function"},{"constant":false,"inputs":[{"name":"_content","type":"bytes32"},{"name":"_accountSlashRepo","type":"string"},{"name":"_commit","type":"bytes20"}],"name":"hint","outputs":[],"type":"function"},{"constant":true,"inputs":[{"name":"","type":"bytes32"}],"name":"entries","outputs":[{"name":"accountSlashRepo","type":"string"},{"name":"commit","type":"bytes20"},{"name":"owner","type":"address"}],"type":"function"},{"constant":false,"inputs":[{"name":"_content","type":"bytes32"}],"name":"unhint","outputs":[],"type":"function"}];
const OperationsABI = [{"constant":false,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_newOwner","type":"address"}],"name":"resetClientOwner","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_release","type":"bytes32"}],"name":"isLatest","outputs":[{"name":"","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_txid","type":"bytes32"}],"name":"rejectTransaction","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_newOwner","type":"address"}],"name":"setOwner","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_number","type":"uint32"},{"name":"_name","type":"bytes32"},{"name":"_hard","type":"bool"},{"name":"_spec","type":"bytes32"}],"name":"proposeFork","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_client","type":"bytes32"}],"name":"removeClient","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_release","type":"bytes32"}],"name":"release","outputs":[{"name":"o_forkBlock","type":"uint32"},{"name":"o_track","type":"uint8"},{"name":"o_semver","type":"uint24"},{"name":"o_critical","type":"bool"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_checksum","type":"bytes32"}],"name":"build","outputs":[{"name":"o_release","type":"bytes32"},{"name":"o_platform","type":"bytes32"}],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"rejectFork","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"bytes32"}],"name":"client","outputs":[{"name":"owner","type":"address"},{"name":"required","type":"bool"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_newOwner","type":"address"}],"name":"setClientOwner","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"uint32"}],"name":"fork","outputs":[{"name":"name","type":"bytes32"},{"name":"spec","type":"bytes32"},{"name":"hard","type":"bool"},{"name":"ratified","type":"bool"},{"name":"requiredCount","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_release","type":"bytes32"},{"name":"_platform","type":"bytes32"},{"name":"_checksum","type":"bytes32"}],"name":"addChecksum","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_txid","type":"bytes32"}],"name":"confirmTransaction","outputs":[{"name":"txSuccess","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"bytes32"}],"name":"proxy","outputs":[{"name":"requiredCount","type":"uint256"},{"name":"to","type":"address"},{"name":"data","type":"bytes"},{"name":"value","type":"uint256"},{"name":"gas","type":"uint256"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_owner","type":"address"}],"name":"addClient","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"clientOwner","outputs":[{"name":"","type":"bytes32"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_txid","type":"bytes32"},{"name":"_to","type":"address"},{"name":"_data","type":"bytes"},{"name":"_value","type":"uint256"},{"name":"_gas","type":"uint256"}],"name":"proposeTransaction","outputs":[{"name":"txSuccess","type":"uint256"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"grandOwner","outputs":[{"name":"","type":"address"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_release","type":"bytes32"},{"name":"_forkBlock","type":"uint32"},{"name":"_track","type":"uint8"},{"name":"_semver","type":"uint24"},{"name":"_critical","type":"bool"}],"name":"addRelease","outputs":[],"payable":false,"type":"function"},{"constant":false,"inputs":[],"name":"acceptFork","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"clientsRequired","outputs":[{"name":"","type":"uint32"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_release","type":"bytes32"}],"name":"track","outputs":[{"name":"","type":"uint8"}],"payable":false,"type":"function"},{"constant":false,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_r","type":"bool"}],"name":"setClientRequired","outputs":[],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"latestFork","outputs":[{"name":"","type":"uint32"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_track","type":"uint8"}],"name":"latestInTrack","outputs":[{"name":"","type":"bytes32"}],"payable":false,"type":"function"},{"constant":true,"inputs":[{"name":"_client","type":"bytes32"},{"name":"_release","type":"bytes32"},{"name":"_platform","type":"bytes32"}],"name":"checksum","outputs":[{"name":"","type":"bytes32"}],"payable":false,"type":"function"},{"constant":true,"inputs":[],"name":"proposedFork","outputs":[{"name":"","type":"uint32"}],"payable":false,"type":"function"},{"inputs":[],"payable":false,"type":"constructor"},{"payable":true,"type":"fallback"},{"anonymous":false,"inputs":[{"indexed":true,"name":"from","type":"address"},{"indexed":false,"name":"value","type":"uint256"},{"indexed":false,"name":"data","type":"bytes"}],"name":"Received","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"txid","type":"bytes32"},{"indexed":true,"name":"to","type":"address"},{"indexed":false,"name":"data","type":"bytes"},{"indexed":false,"name":"value","type":"uint256"},{"indexed":false,"name":"gas","type":"uint256"}],"name":"TransactionProposed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"txid","type":"bytes32"}],"name":"TransactionConfirmed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"txid","type":"bytes32"}],"name":"TransactionRejected","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"txid","type":"bytes32"},{"indexed":false,"name":"success","type":"bool"}],"name":"TransactionRelayed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"number","type":"uint32"},{"indexed":true,"name":"name","type":"bytes32"},{"indexed":false,"name":"spec","type":"bytes32"},{"indexed":false,"name":"hard","type":"bool"}],"name":"ForkProposed","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"number","type":"uint32"}],"name":"ForkAcceptedBy","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"number","type":"uint32"}],"name":"ForkRejectedBy","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"forkNumber","type":"uint32"}],"name":"ForkRejected","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"forkNumber","type":"uint32"}],"name":"ForkRatified","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"forkBlock","type":"uint32"},{"indexed":false,"name":"release","type":"bytes32"},{"indexed":false,"name":"track","type":"uint8"},{"indexed":false,"name":"semver","type":"uint24"},{"indexed":true,"name":"critical","type":"bool"}],"name":"ReleaseAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"release","type":"bytes32"},{"indexed":true,"name":"platform","type":"bytes32"},{"indexed":false,"name":"checksum","type":"bytes32"}],"name":"ChecksumAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":false,"name":"owner","type":"address"}],"name":"ClientAdded","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"}],"name":"ClientRemoved","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":true,"name":"old","type":"address"},{"indexed":true,"name":"now","type":"address"}],"name":"ClientOwnerChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":true,"name":"client","type":"bytes32"},{"indexed":false,"name":"now","type":"bool"}],"name":"ClientRequiredChanged","type":"event"},{"anonymous":false,"inputs":[{"indexed":false,"name":"old","type":"address"},{"indexed":false,"name":"now","type":"address"}],"name":"OwnerChanged","type":"event"}];
