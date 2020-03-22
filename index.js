const AWS = require('aws-sdk');
const costexplorer = new AWS.CostExplorer();
require('date-utils');
const SLACK_URL = process.env['SLACK_URL']
const ratingURL = 'https://www.gaitameonline.com/rateaj/getrate'
const today = new Date();
const yesterday = Date.yesterday();

module.exports.handler = async () => {
  await Promise.all([getMonthly(), getDaily(), getJpyRate()])
    .then(async (results) => {
      const payload = createPayload(results[0], results[1], results[2]);
      const result = await sendToSlack(JSON.stringify(payload)).catch(err => {
        throw new Error(err);
      });
      console.log('完了', `res: ${result[0]}, body: ${result[1]}`)
    })
    .catch(err => {
      throw new Error(err);
    });
};

const sendToSlack = (payload) => {
  return new Promise((resolve, reject) => {
    const request = require('request');
    const options = {
      url: SLACK_URL,
      headers: { 'Content-type': 'application/json' },
      body: payload,
    };
    request.post(options, (err, res, body) => {
      if (err) reject(err);
      else resolve([res, body]);
    });
  });
};

const createPayload = (monthlyList, dailyList, jpyRate) => {
  let totalAmont = 0;
  const allCosts = monthlyList.map(obj => {
    const serviceName = obj.Keys[0];
    const monthlyAmount = Math.floor(obj.Metrics.UnblendedCost.Amount * jpyRate * Math.pow(10, 2)) / Math.pow(10, 2);
    const dailyAmount = () => {
      const dailyIdx = dailyList.findIndex(daily => daily.Keys[0] === serviceName);
      if (dailyIdx !== -1) {
        return Math.floor(dailyList[dailyIdx].Metrics.UnblendedCost.Amount * jpyRate * Math.pow(10, 2)) / Math.pow(10, 2);
      } else {
        return 0;
      }
    };
    totalAmont += monthlyAmount;
    if (serviceName === "Tax") {
      return {
        type: 'mrkdwn',
        text: `> *${serviceName}*\n    ￥${monthlyAmount}`
      };
    } else {
      return {
        type: 'mrkdwn',
        text: `> *${serviceName}*\n    ￥${monthlyAmount}\n    (昨日の利用分: ￥${dailyAmount()})`,
      };
    }
  });
  const fixedTotalAmount = Math.floor(totalAmont * Math.pow(10, 2)) / Math.pow(10, 2);
  let fieldsList = [];
  while (allCosts.length) fieldsList.push(allCosts.splice(0, 10)); 
  const payload = {
    blocks: [
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          "text": `*${today.toFormat('MM')}/01 〜 ${yesterday.toFormat('MM/DD')}* の料金をお知らせします。\n*今日までの合計金額: ￥${fixedTotalAmount}*\n1$ = ${jpyRate}円 \n*<https://console.aws.amazon.com/billing/home#/|AWS 請求ダッシュボード>*`
        }
      },
      {
  			"type": "divider"
  		}
    ]
  };
  fieldsList.forEach(fields => {
    payload.blocks.push({ 
      "type": "section",
      "fields": fields
    });
  });
  return payload;
};

const getMonthly = () => {
  return new Promise((resolve, reject) => {
    const params = {
      Granularity: 'MONTHLY',
      Metrics: [ 'UnblendedCost' ],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      TimePeriod: {
        Start: `${today.toFormat('YYYY-MM')}-01`,
        End: today.toFormat('YYYY-MM-DD'),
      },
    };
    costexplorer.getCostAndUsage(params, (err, data) => {
      if (err) reject(err);
      else resolve(data.ResultsByTime[0].Groups);
    });
  });
};

const getDaily = () => {
  return new Promise((resolve, reject) => {
    const params = {
      Granularity: 'DAILY',
      Metrics: [ 'UnblendedCost' ],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      TimePeriod: {
        Start: yesterday.toFormat('YYYY-MM-DD'),
        End: today.toFormat('YYYY-MM-DD'),
      },
    };
    costexplorer.getCostAndUsage(params, (err, data) => {
      if (err) reject(err);
      else resolve(data.ResultsByTime[0].Groups);
    });
  });
};

const getJpyRate = () => {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request(ratingURL, (res) => {
      res.on('data', (chunk) => {
        const rates = JSON.parse(chunk);
        const jpyIdx = rates.quotes.findIndex(quote => quote.currencyPairCode === 'USDJPY');
        resolve(rates.quotes[jpyIdx].ask);
      });
      res.on('end', () => {
          console.log('No more data in response.');
      });
      res.on('error', (err) => {
        reject(err);
      })
    });
    req.end();
  });
};