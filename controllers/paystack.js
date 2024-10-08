// const Axios = require('axios');
const paymentLog = require('../models/billings/paymentLog');

const {
  PAYSTACK_INITIALIZE_URL,
  PAYSTACK_TEST_SECRET,
} = process.env;

class PaystackService {
  static async paywithPaystack(req, res) {
    try {

      let { name, email, amount } = req.body;

      const response = await PaystackService.initializeTransaction({
        currency: 'NGN',
        metadata: {
          name,
          email
        },
        email: businessEmail,
        amount,
      });

   
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
        resolve(response.data);
      } catch (error) {
        // console.log(error, "errrrrrrrrrrrrrrrrrrrrrrrrr");
        reject(error);
      }
    });
  }

  // static async verifyTransaction(reference) {
  //   return new Promise(async (resolve, reject) => {
  //     try {
  //       const response = await Axios.get(
  //         `${PAYSTACK_TXN_VERIFY_URL}/${reference}`,
  //         {
  //           headers: {
  //             Authorization: `Bearer ${process.env.PAYSTACK_TEST_SECRET}`,
  //           },
  //         }
  //       );

  //       const { new_plan } = response.data.data.metadata;
  //       new_plan.authorization_code =
  //         response.data.data.authorization.authorization_code;
  //       const fromLog = await BillingLogSchema.findOne({
  //         transaction_ref: response.data.data.reference,
  //       });

  //       if (!fromLog) return reject({ message: 'Billing not found' });
  //       if (fromLog.amount * 100 !== response.data.data.amount) {
  //         reject(new Error('Amount do not match'));
  //       }

  //       fromLog.payment_status = 'PAYMENT_CONFIRMED';

  //       // await fromLog.save();
  //       await BusinessBillingSchema.updateOne(
  //         { storeId: fromLog.accountId },
  //         { $set: new_plan }
  //       );

  //       resolve(fromLog);
  //     } catch (error) {
  //       reject(error);
  //     }
  //   });
  // }

  // static async initializeTransaction2(payload) {
  //   const https = require('https');

  //   const params = JSON.stringify(payload);

  //   const options = {
  //     hostname: 'api.paystack.co',
  //     port: 443,
  //     path: '/transaction/initialize',
  //     method: 'POST',
  //     headers: {
  //       Authorization: `Bearer ${PAYSTACK_TEST_SECRET}`,
  //       'Content-Type': 'application/json',
  //     },
  //   };

  //   const req = https
  //     .request(options, (res) => {
  //       let data = '';

  //       res.on('data', (chunk) => {
  //         data += chunk;
  //       });

  //       res.on('end', () => {
  //         const result = JSON.parse(data);

  //         return result;
  //       });
  //     })
  //     .on('error', () => {});

  //   req.write(params);
  //   req.end();
  // }

  
}

module.exports = PaystackService;