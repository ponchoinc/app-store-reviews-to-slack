'use strict';

require('dotenv').config();

require('./index').handler({}, {
  done: (type, msg) => {
    // eslint-disable-next-line no-console
    console.log('TYPE', type, 'MSG', msg);
    process.exit();
  },
});
