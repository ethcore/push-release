const chai = require('chai');
const chaiHttp = require('chai-http');
const ServerMock = require('mock-http-server');

const expect = chai.expect;
chai.use(chaiHttp);

const app = require('../server');
const secret = 'test';
const gasPrice = '0x4f9aca000';

const server = new ServerMock({ host: 'localhost', port: 8545 });

describe('push-release', () => {
	it('should reject invalid secret', async () => {
		let res = await request(app => app
			.post('/push-release/v1.9.5/123')
			.type('form')
			.send({ secret: 'xx' })
		);

		expect(res).to.have.status(400);
		expect(res.text).to.equal('Error while processing the request:\nInvalid secret\n');
	});

	it('should reject invalid tags', async () => {
		const test = async tag => {
			let res = await request(app => app
				.post(`/push-release/${tag}/123`)
				.type('form')
				.send({ secret })
			);

			expect(res).to.have.status(400);
			expect(res.text).to.equal(`Error while processing the request:\nInvalid tag: ${tag}\n`);
		};

		await test('xxx');
		await test('v1.9.5-ci0');
	});

	beforeEach(done => server.start(done));
	afterEach(done => server.stop(done));

	it('should push release succesfuly', async () => {
		const requests = [];
		server.on({
			method: 'POST',
			path: '/',
			reply: {
				status: 200,
				headers: { 'content-type': 'application/json' },
				body (req) {
					requests.push(req.body);
					return JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						result: 'kovan'
					})
				}
			}
		});

		let res = await request(app => app
			.post('/push-release/v1.7.13/8b749367fd5fea897cee98bd892fff1ce90f8260')
			.type('form')
			.send({ secret })
		);

		expect(res).to.have.status(200);
		// Register in operations
		expect(requests[3].method).to.equal('eth_sendTransaction');
		expect(requests[3].params).to.deep.equal([{
			data:			'0x932ab2700000000000000000000000008b749367fd5fea897cee98bd892fff1ce90f826000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000001070d0000000000000000000000000000000000000000000000000000000000000000',
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
			gasPrice,
			to: '0x'
		}]);
	});
});

describe('push-build', () => {
	it('should reject invalid secret', async () => {
		let res = await request(app => app
			.post('/push-build/v1.9.5/x86_64-unknown-linux-gnu')
			.type('form')
			.send({ secret: 'xx' })
		);

		expect(res).to.have.status(400);
		expect(res.text).to.equal('Error while processing the request:\nInvalid secret\n');
	});

	it('should reject invalid tags', async () => {
		const test = async tag => {
			let res = await request(app => app
				.post(`/push-build/${tag}/x86_64-unknown-linux-gnu`)
				.type('form')
				.send({ secret, sha3: 'none' })
			);

			expect(res).to.have.status(400);
			expect(res.text).to.equal(
				`Error while processing the request:\nInvalid sha3 (none), tag (${tag}) or platform (x86_64-unknown-linux-gnu).\n`);
		};

		await test('xxx');
		await test('v1.9.5-ci0');
	});

	beforeEach(done => server.start(done));
	afterEach(done => server.stop(done));

	it('should push build succesfuly', async () => {
		const requests = [];
		server.on({
			method: 'POST',
			path: '/',
			reply: {
				status: 200,
				headers: { 'content-type': 'application/json' },
				body (req) {
					requests.push(req.body);
					return JSON.stringify({
						jsonrpc: '2.0',
						id: 1,
						result: 'kovan'
					})
				}
			}
		});

		let res = await request(app => app
			.post('/push-build/v1.7.13/x86_64-unknown-linux-gnu')
			.type('form')
			.send({
				secret,
				sha3: 'beefcafe',
				commit: '8b749367fd5fea897cee98bd892fff1ce90f8260'
			})
		);

		expect(res).to.have.status(200);
		// Githubhint registration
		expect(requests[3].method).to.equal('eth_sendTransaction');
		expect(requests[3].params).to.deep.equal([{
			data:		'0x02f2008dbeefcafe000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000004f687474703a2f2f64316834786c3463723168306d6f2e636c6f756466726f6e742e6e65742f76312e372e31332f7838365f36342d756e6b6e6f776e2d6c696e75782d676e752f756e646566696e65640000000000000000000000000000000000',
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
			gasPrice,
			to: '0x'
		}]);
		// Build registration
		expect(requests[5].method).to.equal('eth_sendTransaction');
		expect(requests[5].params).to.deep.equal([{
			data:		'0x793b0efb0000000000000000000000008b749367fd5fea897cee98bd892fff1ce90f82607838365f36342d756e6b6e6f776e2d6c696e75782d676e750000000000000000beefcafe00000000000000000000000000000000000000000000000000000000',
			from: '0x0066ac7a4608f350bf9a0323d60dde211dfb27c0',
			gasPrice,
			to: '0x'
		}]);
	});
});

// Overcoming a bug in chai-http: https://github.com/chaijs/chai-http/issues/156
function request (fn) {
	return new Promise((resolve, reject) => {
		return fn(chai.request(app)).end((err, res) => {
			if (res) {
				resolve(res);
			} else {
				reject(err);
			}
		});
	});
}
