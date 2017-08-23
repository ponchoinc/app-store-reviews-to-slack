'use strict';

// eslint-disable-next-line import/no-extraneous-dependencies
const AWS = require('aws-sdk');
const countries = require('countries-list').countries;
const moment = require('moment');
const parseString = require('xml2js').parseString;
const Promise = require('bluebird');
const rp = require('request-promise');

const { iosCountries } = require('./config.js');

process.env.TZ = 'UTC';


/** SimpleDB config */
AWS.config.setPromisesDependency(Promise);
const db = new AWS.SimpleDB({
  region: process.env.AWS_REGION || 'us-west-2',
  endpoint: process.env.AWS_SIMPLEDB_ENDPOINT || 'https://sdb.us-west-2.amazonaws.com',
});

const DomainName = process.env.AWS_SIMPLEDB_DOMAIN || 'AppReviews';


/** AWS export function */
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
          const attrs = item.Attributes.filter(attr => (
            attr.Name === attrName && attr.Value
          )).map(attr => (
            Object.assign({}, attr, { Value: parseInt(attr.Value, 10) })
          )).sort((a, b) => (
            // to get last, reverse and get first
            b.Value - a.Value
          ));
          val = attrs[0].Value;
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
    const attrName = 'LastReviewId';
    const color = '#5DA5FB';
    const attachments = [];

    /** Iterate through all specified countries, with concurrency */
    return Promise.mapSeries(iosCountries, (code) => {
      const country = countries[code];
      const ItemName = `IosReviewId-${code}`;
      const url = `https://itunes.apple.com/${code}/rss/customerreviews/id=${iosAppId}/xml`;

      return dbGetValue(ItemName, attrName).then((lastId = 0) =>
        rp.get(url).then(data =>
          new Promise((resolve, reject) => {
            parseString(data, (err, result) => {
              if (err || !result.feed || !result.feed.entry) {
                reject(err || 'No feed entries');
              }

              let newestId = lastId || 0;
              result.feed.entry.shift();
              result.feed.entry.forEach((entry) => {
                const updated = moment(entry.updated[0]);
                const { stars } = starRating(parseInt(entry['im:rating'][0], 10));
                const entryId = parseInt(entry.id[0], 10);
                newestId = Math.max(entryId, newestId);

                if (entryId > (lastId || 0)) {
                  attachments.push({
                    fallback: `${stars} - ${entry.title[0]}`,
                    color,
                    title: `${stars} - ${entry.title[0]}`,
                    title_link: entry.author[0].uri[0],
                    text: entry.content[0]._,
                    footer: `v${entry['im:version'][0]}  |  ${country.emoji} ${country.name}  |  ${entry.author[0].name[0]}`,
                    ts: updated.unix(),
                  });
                }
              });

              return dbPutValue(ItemName, attrName, newestId).then(resolve);
            });
          }))).catch(() => false);
    }, { concurrency: 15 }).then(() => {
      if (attachments.length) {
        return postAttachmentsToSlack(attachments.reverse(), { username: 'iOS Reviews' });
      }
      return false;
    });
  };

  const iosRatings = () => {
    const attrName = 'LastReviewCount';

    /** Iterate through all specified countries, with concurrency */
    return Promise.mapSeries(iosCountries, (code) => {
      const country = countries[code];
      const ItemName = `IosReviewId-${code}`;
      const url = `https://itunes.apple.com/lookup?id=${iosAppId}&country=${code}`;

      return dbGetValue(ItemName, attrName).then((lastCount = 0) =>
        rp.get(url).then((data) => {
          const results = JSON.parse(data).results[0];
          const text = [];
          const count = results.userRatingCount || results.userRatingCountForCurrentVersion;

          if (!results.averageUserRatingForCurrentVersion && !results.averageUserRating) {
            return false;
          }

          // Heading
          text.push(`${country.emoji} *${country.name}*`);

          // Current version
          if (results.averageUserRatingForCurrentVersion) {
            const currentRating = starRating(results.averageUserRatingForCurrentVersion);
            text.push(`> Current iOS version (${results.version}) is rated ${currentRating.stars} (${results.averageUserRatingForCurrentVersion}) among ${results.userRatingCountForCurrentVersion} reviewers.`);
          } else {
            text.push('> Current iOS version has not received enough reviews for a rating.');
          }

          // All versions
          if (results.averageUserRating) {
            const allRatings = starRating(results.averageUserRating);
            text.push(`> Overall iOS app is rated ${allRatings.stars} (${results.averageUserRating}) among ${count} reviewers.`);
          } else {
            text.push('> Overall iOS app has not received enough reviews for a rating.');
          }

          if (count > (lastCount || 0)) {
            return dbPutValue(ItemName, attrName, count).then(() => text.join('\n'));
          }
          return false;
        }).catch(() => false));
    }, { concurrency: 15 }).then((items) => {
      const groups = arrayGroupings(items.filter(Boolean), 5);
      return Promise.mapSeries(groups, text =>
        postTextToSlack(text.join('\n'), { username: 'iOS Reviews', mrkdwn: true }));
    });
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


  /** --- EXECUTE CODE --- */
  const fn = (appFn => appFn && appFn.call());
  return db.createDomain({ DomainName }).promise().catch(() => false).then(() =>
    Promise.mapSeries([
      /** iOS ratings */
      iosAppId && (() => iosReviews()),
      iosAppId && (() => iosRatings()),

      /* Android ratings */
      androidAppId && androidReviews(),
      androidAppId && androidRatings(),
    ], fn, { concurrency: 4 })
      .then(() => context.done(null, ''))
      .catch(err => context.done(err, '')));
};
