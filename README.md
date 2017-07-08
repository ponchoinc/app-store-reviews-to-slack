# Slack App Reviews

Post the latest iOS and Android app reviews to your Slack team.

Requires AWS Lambda, AWS Cloudwatch Scheduler, and AWS SimpleDB.


## Setup


#### Obtaining Slack Incoming Webhook URL

...


#### AWS SimpleDB

...


#### AWS Lambda

The Lambda user will need to have SimpleDB IAM permissions to access the specified DomainName. 

Something like this:
```
{
  "Version": "2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Action":"sdb:*",
    "Resource":"arn:aws:sdb:*:ACCOUNT-ID:domain/AppReviews"
  }]
}
```

To generate a ZIP file to upload to Lambda, run `npm run zip`.


#### AWS Cloudwatch Event Scheduling

...


## Configuration

You should specify the following ENV variables when creating your Lambda function.

| Name | Default Value | Description |
|------|---------------|-------------|
| AWS_REGION | 'us-west-2' | AWS Region for using SimpleDB |
| AWS_SIMPLEDB_ENDPOINT | 'https://sdb.us-west-2.amazonaws.com' | Endpoint URL for SimpleDB |
| AWS_SIMPLEDB_DOMAIN | 'AppReviews' | SimpleDB domain name for storing information |
| ANDROID_APP_ID | `undefined` | Android app identifier (string). Will not fetch Goole Play store reviews if left blank. |
| IOS_APP_ID | `undefined` | iOS app identifier (number). Will not fetch iOS App Store reviews if left blank. |
| SLACK_WEBHOOK_URL | `undefined` | Slack incoming webhook url. Will not post to Slack if not defined. |


When testing locally, you can add these to a `.env` file that will load using `dotenv` module.


## Testing

You can setup your .ENV file or export the necessay ENV vars to test locally and run `npm test`.

If you need to reset your SimpleDB domain, you can run `node reset.js`.


## Credits

Copyright 2017 Poncho, Inc.
