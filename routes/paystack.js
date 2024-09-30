/* eslint-disable node/no-unsupported-features/es-syntax */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable consistent-return */
/* eslint-disable global-require */
/* eslint-disable no-promise-executor-return */
/* eslint-disable prefer-promise-reject-errors */
/* eslint-disable no-async-promise-executor */
/* eslint-disable prefer-const */

const Axios = require('axios');
const BranchSchema = require('../models/businesses/branches');
const BillingLogSchema = require('../models/billings/billing_log');
const BusinessBillingSchema = require('../models/billings/store_billing');
const CorisioPlansSchema = require('../models/corisio/plans');
const paymentLog = require('../models/billings/paymentLog');

const {
  PAYSTACK_INITIALIZE_URL,
  PAYSTACK_TXN_VERIFY_URL,
  PAYSTACK_TEST_SECRET,
} = process.env;

class PaystackService {
  static async paywithPaystack(req, res) {
    try {
      const { store, storeId, businessEmail } = req.user;
      let { start_date, plan_name, period } = req.body;

      const next_renewer_date = new Date();
      const trialDays = period === 'month' ? 30 : 365;
      const plan_code =
        period === 'month' ? 'paystack_monthly_plan' : 'paystack_yearly_plan';
      let amount = 0;
      if (!start_date) start_date = new Date();
      const previous_plan =
        await BusinessBillingSchema.findById(storeId).lean();
      const result = await CorisioPlansSchema.findOne({ plan_name });

      if (result.plan_name === 'Freemium') {
        return res.status(400).send({
          message: 'select a valid plan',
        });
      }

      const branchesCount = await BranchSchema.count({ store });

      const func = (start) => {
        const expire = new Date();
        expire.setDate(parseInt(start.getDate()) + parseInt(trialDays));
        return expire;
      };

      const expiring_date = func(start_date);
      next_renewer_date.setDate(
        parseInt(start_date.getDate()) + parseInt(trialDays) + 1
      );

      if (period === 'month') {
        amount = parseInt(result.monthly_billing) * branchesCount;
      }
      if (period === 'year') {
        amount = parseInt(result.yearly_billing) * branchesCount;
      }

      const current_life_plan =
        (new Date(expiring_date).getTime() - new Date(start_date).getTime()) /
        (1000 * 60 * 60 * 24 * 12);

      const response = await PaystackService.initializeTransaction({
        metadata: {
          new_plan: {
            start_date: new Date(start_date),
            expiring_date: new Date(expiring_date),
            interval_remaining: parseInt(trialDays),
            next_renewer_date,
            current_life_plan:
              parseInt(current_life_plan) < 1
                ? `1 month`
                : `${parseInt(current_life_plan)} months`,
            amount,
            plan_name,
            period,
            previous_plan: previous_plan ? previous_plan.plan : 'Basic',
          },
        },
        plan: result[plan_code],
        email: businessEmail,
        amount,
      });

      await BusinessBillingSchema.create(
        {
          payment_status: 'PENDING_PAYMENT_CONFIRMATION',
          amount,
          period,
          date: Date.now(),
          paymentChannel: 'PAYSTACK',
          transaction_ref: response.data.reference,
          company: req.user.company,
        },
        {
          raw: true,
        }
      ).save();

      await BillingLogSchema.create({
        start_date: new Date(start_date),
        expiring_date: new Date(expiring_date),
        store,
        transaction_ref: response.data.reference,
        interval_remaining: parseInt(trialDays),
        next_renewer_date,
        current_life_plan:
          parseInt(current_life_plan) < 1
            ? `1 month`
            : `${parseInt(current_life_plan)} months`,
        amount,
        plan_name,
        period,
        previous_plan: previous_plan.plan,
      }).save();
      return res.status(200).send({ checkoutUrl: response.data });
    } catch (error) {
      res.status(500).send({ message: 'internal server error' });
    }
  }

  static async initializeTransaction(payload) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!process.env.PAYSTACK_SECRET) {
          reject(new Error('PAYSTACK SECRET KEY MISSING'));
        }
        if (!payload.email || payload.email.trim() === '') {
          reject(new Error('Could not initialize. Email not provided'));
        }
        if (!payload.amount || Number.isNaN(payload.amount)) {
          reject(new Error('Could not initialize. Amount not provided'));
        }

        const response = await Axios.post(
          PAYSTACK_INITIALIZE_URL,
          {
            email: payload.email,
            metadata: payload.metadata,
            plan: payload.plan,
            amount: parseInt(payload.amount) * 100,
          },
          {
            headers: {
              Authorization: `Bearer ${PAYSTACK_TEST_SECRET}`,
              'Content-Type': 'application/json',
            },
          }
        );

        await paymentLog.create({
          access_code: response.data.data.access_code,
          reference: response.data.data.reference,
          user_email: payload.email,
          authorization_url: response.data.data.authorization_url,
          type: 'paystack',
        });
        resolve(response.data);
      } catch (error) {
        // console.log(error, "errrrrrrrrrrrrrrrrrrrrrrrrr");
        reject(error);
      }
    });
  }

  static async verifyTransaction(reference) {
    return new Promise(async (resolve, reject) => {
      try {
        const response = await Axios.get(
          `${PAYSTACK_TXN_VERIFY_URL}/${reference}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET}`,
            },
          }
        );

        const { new_plan } = response.data.data.metadata;
        new_plan.authorization_code =
          response.data.data.authorization.authorization_code;
        const fromLog = await BillingLogSchema.findOne({
          transaction_ref: response.data.data.reference,
        });

        if (!fromLog) return reject({ message: 'Billing not found' });
        if (fromLog.amount * 100 !== response.data.data.amount) {
          reject(new Error('Amount do not match'));
        }

        fromLog.payment_status = 'PAYMENT_CONFIRMED';

        // await fromLog.save();
        await BusinessBillingSchema.updateOne(
          { storeId: fromLog.accountId },
          { $set: new_plan }
        );

        resolve(fromLog);
      } catch (error) {
        reject(error);
      }
    });
  }

  static async initializeTransaction2(payload) {
    const https = require('https');

    const params = JSON.stringify(payload);

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: '/transaction/initialize',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_TEST_SECRET}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https
      .request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          const result = JSON.parse(data);

          return result;
        });
      })
      .on('error', () => {});

    req.write(params);
    req.end();
  }

  static async SuperCreatePaystackPlan(req, res) {
    const https = require('https');
    const { name, frequency, amount, plan } = req.body;
    const params = JSON.stringify({
      name,
      interval: frequency,
      amount,
    });

    if (plan === 1) return res.status(400).errorMessage('invalid Plan');

    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path: '/plan',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_TEST_SECRET}`,
        'Content-Type': 'application/json',
      },
    };

    const request = https
      .request(options, (resp) => {
        let data = '';

        resp.on('data', (chunk) => {
          data += chunk;
        });

        resp.on('end', async () => {
          const result = JSON.parse(data);

          if (result.status) {
            const { data: thePlan } = result;
            const plan_code =
              frequency === 'monthly'
                ? {
                    paystack_monthly_plan: thePlan.plan_code,
                    monthly_billing: thePlan.amount,
                  }
                : {
                    paystack_yearly_plan: thePlan.plan_code,
                    yearly_billing: thePlan.amount,
                  };
            await CorisioPlansSchema.updateOne(
              { plan_name: thePlan.name },
              {
                $set: {
                  plan_id: thePlan.id,
                  plan_name: thePlan.name,
                  currency: thePlan.currency,
                  ...plan_code,
                },
              },
              { upsert: true }
            );
          }
          return res.status(201).send(result);
        });
      })
      .on('error', (error) => res.status(400).errorMessage(error));
    request.write(params);
    request.end();
  }
}

module.exports = PaystackService;