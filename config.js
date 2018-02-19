const rc = require('rc');

const defaults = {
  'ignore-unknown': true
};

const config = rc('krot', defaults);

module.exports = config;