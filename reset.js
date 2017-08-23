'use strict';

// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');
const Promise = require('bluebird');

const { iosCountries } = require('./config');

/** SimpleDB Setup */
const db = new AWS.SimpleDB({
  region: process.env.AWS_REGION || 'us-west-2',
  endpoint: process.env.AWS_SIMPLEDB_ENDPOINT || 'https://sdb.us-west-2.amazonaws.com',
});

const DomainName = process.env.AWS_SIMPLEDB_DOMAIN || 'AppReviews';

/** Item Names */
const items = iosCountries.map(code => `IosReviewId-${code}`)
  .concat(['IosReviewId', 'AndroidReviewId']);

/** Execution code */
const fn = (ItemName => db.deleteAttributes({ DomainName, ItemName }).promise());
Promise.mapSeries(items, fn, { concurrency: 15 })
  .then(() => process.exit());
