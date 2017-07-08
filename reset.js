'use strict';

const AWS = require('aws-sdk');
const Promise = require('bluebird');

const db = new AWS.SimpleDB({
  region: 'us-west-2',
  endpoint: 'https://sdb.us-west-2.amazonaws.com',
});

const DomainName = 'AppReviews';

const items = ['IosReviewId', 'AndroidReviewId'];
const fn = (ItemName) => {
  return db.deleteAttributes({ DomainName, ItemName }).promise();
};

return Promise.mapSeries(items, fn)
  .then(() => process.exit());
