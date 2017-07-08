'use strict';

// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');
const moment = require('moment');
const parseString = require('xml2js').parseString;
const Promise = require('bluebird');
const rp = require('request-promise');

process.env.TZ = 'UTC';

AWS.config.setPromisesDependency(Promise);
const db = new AWS.SimpleDB({
  region: process.env.AWS_REGION || 'us-west-2',
  endpoint: process.env.AWS_SIMPLEDB_ENDPOINT || 'https://sdb.us-west-2.amazonaws.com',
});

const DomainName = process.env.AWS_SIMPLEDB_DOMAIN || 'AppReviews';


/** AWS export */
exports.handler = function AppReviews(event, context) {
  const androidAppId = (event && event.androidAppId) || process.env.ANDROID_APP_ID;
  const iosAppId = (event && event.iosAppId) || process.env.IOS_APP_ID;
  const slackWebhookUrl = (event && event.slackWebhookUrl) || process.env.SLACK_WEBHOOK_URL;


  /** --- HELPERS --- */
  const dbGetValue = (itemName, attrName) => {
    const SelectExpression =
      `select ${attrName} from ${DomainName} where itemName() = '${itemName}' LIMIT 1`;

    return db.select({ SelectExpression }).promise().then((resp) => {
      let val;
      if (resp.Items && resp.Items.length) {
        const item = resp.Items[0];
        if (item.Name === itemName && item.Attributes && item.Attributes.length) {
          item.Attributes.forEach((attr) => {
            if (attr.Name === attrName && attr.Value) {
              val = attr.Value;
            }
          });
        }
      }
      return val;
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.log(err);
      return null;
    });
  };

  const dbPutValue = (ItemName, attrName, val) =>
    db.putAttributes({
      DomainName,
      ItemName,
      Attributes: [
        { Name: attrName, Value: val.toString() },
      ],
    }).promise();

  const arrayGroupings = (items, n = 10) => {
    const groups = [];
    items.forEach((item, i) => {
      const group = Math.floor(i / n);
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(item);
    });

    return groups;
  };

  const starRating = (score, total = 5) => {
    const rating = new Array(Math.floor(score));
    const givenStars = rating.fill('★').join('');
    const notGivenStars = new Array(total - rating.length).fill('☆').join('');
    const stars = `${givenStars}${notGivenStars}`;
    return { stars, givenStars, notGivenStars };
  };


  /** --- SLACK --- */
  const postTextToSlack = (text, json = {}) =>
    rp.post({
      uri: slackWebhookUrl,
      json: Object.assign({
        mrkdwn: false,
        unfurl_links: false,
        text,
      }, json),
    });

  const postAttachmentsToSlack = (items, json = {}) => {
    if (!items && items.length === 0) {
      return false;
    }

    const groups = arrayGroupings(items, 10);
    return Promise.mapSeries(groups, attachments =>
      rp.post({
        uri: slackWebhookUrl,
        json: Object.assign({
          mrkdwn: false,
          unfurl_links: false,
          attachments,
        }, json),
      }));
  };


  /** --- iOS --- */
  const iosReviews = () => {
    const ItemName = 'IosReviewId';
    const attrName = 'LastReviewId';
    const color = '#5DA5FB';
    const url = `http://itunes.apple.com/rss/customerreviews/id=${iosAppId}/xml`;
    const attachments = [];

    return dbGetValue(ItemName, attrName).then((lastId = 0) =>
      rp.get(url).then(data =>
        new Promise((resolve, reject) => {
          parseString(data, (err, result) => {
            if (err) {
              reject(err);
            }

            let newestId = lastId || 0;
            result.feed.entry.shift();
            result.feed.entry.forEach((entry) => {
              const updated = moment(entry.updated[0]);
              const { stars } = starRating(parseInt(entry['im:rating'][0], 10));
              newestId = Math.max(entry.id[0], newestId);

              if (entry.id[0] > (lastId || 0)) {
                attachments.push({
                  fallback: `${stars} - ${entry.title[0]}`,
                  color,
                  title: `${stars} - ${entry.title[0]}`,
                  title_link: entry.author[0].uri[0],
                  text: entry.content[0]._,
                  footer: `v${entry['im:version'][0]}  | ${entry.author[0].name[0]}`,
                  ts: parseInt(updated.valueOf() / 1000, 10),
                });
              }
            });

            return dbPutValue(ItemName, attrName, newestId).then(resolve);
          });
        }).then(() => {
          if (attachments.length) {
            return postAttachmentsToSlack(attachments.reverse(), { username: 'iOS Reviews' });
          }
          return false;
        })));
  };

  const iosRatings = () => {
    const ItemName = 'IosReviewId';
    const attrName = 'LastReviewCount';
    const url = `http://itunes.apple.com/lookup?id=${iosAppId}`;

    return dbGetValue(ItemName, attrName).then((lastCount = 0) =>
      rp.get(url).then((data) => {
        const results = JSON.parse(data).results[0];
        const text = [];
        const currentCount = results.userRatingCount;

        // Current version
        const currentRating = starRating(results.averageUserRatingForCurrentVersion);
        text.push(`Current iOS version (${results.version}) is rated ${currentRating.stars} (${results.averageUserRatingForCurrentVersion}) among ${results.userRatingCountForCurrentVersion} reviewers.`);

        // All versions
        const allRatings = starRating(results.averageUserRating);
        text.push(`Overall iOS app is rated ${allRatings.stars} (${results.averageUserRating}) among ${currentCount} reviewers.`);

        if (currentCount > (lastCount || 0)) {
          return dbPutValue(ItemName, attrName, currentCount).then(() =>
            postTextToSlack(text.join('\n'), { username: 'iOS Reviews' }));
        }
        return false;
      }));
  };


  /** --- ANDROID --- */
  const androidReviews = () => {
    // @TODO
    const android = false;
    return android;
  };

  const androidRatings = () => {
    // @TODO
    const android = false;
    return android;
  };


  /** EXECUTE CODE --- */
  const fn = (appFn => appFn && appFn.call());
  return db.createDomain({ DomainName }).promise().catch(() => false).then(() =>
    Promise.mapSeries([
      /** iOS ratings */
      iosAppId && (() => iosReviews()),
      iosAppId && (() => iosRatings()),

      /* Android ratings */
      androidAppId && androidRatings(),
      androidAppId && androidReviews(),
    ], fn)
      .then(() => context.done(null, ''))
      .catch(err => context.done(err, '')));
};
