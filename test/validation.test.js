const { expect } = require('chai');
const { tag } = require('../validation');

it('should allow nightly', () => {
	const result = tag.validate('nightly');

	expect(result.value).to.equal('nightly');
});
