'use strict';

require('dotenv').config();

require('./index').handler({}, {
  done: (type, msg) => {
    console.log('TYPE', type, 'MSG', msg);
    process.exit();
  }
});
