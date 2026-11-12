// server.js - the shop API (json-server) plus a real M-Pesa STK push (Safaricom Daraja).
//
// Routes:
//   everything json-server already gives you: /products, /orders, /deliveryZones ...
//   POST /mpesa/stkpush   { orderId }  -> sends the "enter your PIN" prompt to the customer's phone
//   POST /mpesa/callback                -> Safaricom calls this when the customer pays or cancels
//
// Settings come from environment variables (on Render: Environment tab). Never put them in the website code.
//   MPESA_ENV              sandbox (default) or production
//   MPESA_CONSUMER_KEY     from your Daraja app
//   MPESA_CONSUMER_SECRET  from your Daraja app
//   MPESA_SHORTCODE        174379 in sandbox, your Paybill / Till number in production
//   MPESA_PASSKEY          sandbox passkey from Daraja (production passkey comes from Safaricom)
//   MPESA_CALLBACK_URL     https://<your-render-app>.onrender.com/mpesa/callback
//   MPESA_TRANSACTION_TYPE CustomerPayBillOnline (default) or CustomerBuyGoodsOnline for a Till
//   PORT                   set automatically by Render
import jsonServer from 'json-server';

const PORT = process.env.PORT || 3000;
const ENV = process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
const DARAJA = process.env.MPESA_BASE_URL
  || (ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');
const SHORTCODE = process.env.MPESA_SHORTCODE || '174379';
const TRANSACTION_TYPE = process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline';

const server = jsonServer.create();
const router = jsonServer.router(process.env.DB_FILE || 'db.json');
const db = router.db; // lowdb, so we can update orders from the callback

server.use(jsonServer.defaults()); // CORS, logging, static files
server.use(jsonServer.bodyParser);

// New orders always start unpaid. Only the M-Pesa callback below can mark one as paid.
server.post('/orders', (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body.status = 'pending';
    delete req.body.mpesa;
  }
  next();
});

// ---------- Daraja helpers ----------

function timestamp(date = new Date()) {
  // Daraja wants YYYYMMDDHHmmss in Kenyan time.
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

let cachedToken = null;
async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('M-Pesa is not set up on the server (missing consumer key/secret).');
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await fetch(`${DARAJA}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Daraja login failed (${res.status}). Check the consumer key and secret.`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3599) - 60) * 1000 };
  return cachedToken.value;
}

async function sendStkPush({ phone, amount, reference }) {
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_CALLBACK_URL;
  if (!passkey || !callbackUrl) throw new Error('M-Pesa is not set up on the server (missing passkey or callback URL).');
  const ts = timestamp();
  const body = {
    BusinessShortCode: SHORTCODE,
    Password: Buffer.from(`${SHORTCODE}${passkey}${ts}`).toString('base64'),
    Timestamp: ts,
    TransactionType: TRANSACTION_TYPE,
    Amount: Math.max(1, Math.round(amount)),
    PartyA: phone,
    PartyB: SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: reference.slice(0, 12),
    TransactionDesc: 'Kicks Hub order',
  };
  const res = await fetch(`${DARAJA}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || `M-Pesa request failed (${res.status}).`);
  }
  return data; // { MerchantRequestID, CheckoutRequestID, CustomerMessage, ... }
}

// ---------- M-Pesa routes ----------

server.post('/mpesa/stkpush', async (req, res) => {
  const orderId = Number(req.body?.orderId);
  const order = db.get('orders').find({ id: orderId }).value();
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.payment !== 'mpesa') return res.status(400).json({ error: 'This order is not an M-Pesa order.' });
  if (order.status === 'paid') return res.status(400).json({ error: 'This order is already paid.' });

  try {
    // Amount and phone come from the saved order, never from the browser request.
    const result = await sendStkPush({
      phone: order.customer.phone,
      amount: order.total,
      reference: `KH${order.id}`,
    });
    db.get('orders').find({ id: orderId })
      .assign({ status: 'awaiting_payment', mpesa: { checkoutRequestId: result.CheckoutRequestID }, updatedAt: new Date().toISOString() })
      .write();
    res.json({ checkoutRequestId: result.CheckoutRequestID, message: result.CustomerMessage });
  } catch (error) {
    console.error('STK push failed:', error.message);
    res.status(502).json({ error: error.message });
  }
});

server.post('/mpesa/callback', (req, res) => {
  // Always answer Safaricom with success, otherwise it keeps retrying.
  const cb = req.body?.Body?.stkCallback;
  if (cb?.CheckoutRequestID) {
    const order = db.get('orders').find((o) => o.mpesa?.checkoutRequestId === cb.CheckoutRequestID);
    if (order.value()) {
      const items = cb.CallbackMetadata?.Item || [];
      const get = (name) => items.find((i) => i.Name === name)?.Value;
      const paid = Number(cb.ResultCode) === 0;
      order.assign({
        status: paid ? 'paid' : 'payment_failed',
        mpesa: {
          ...order.value().mpesa,
          resultCode: cb.ResultCode,
          resultDesc: cb.ResultDesc,
          receipt: get('MpesaReceiptNumber') || null,
          amountPaid: get('Amount') ?? null,
        },
        updatedAt: new Date().toISOString(),
      }).write();
      console.log(`Order ${order.value().id}: ${paid ? 'PAID' : 'not paid'} (${cb.ResultDesc})`);
    }
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

server.use(router);

server.listen(PORT, () => {
  console.log(`Kicks Hub API on port ${PORT} (M-Pesa ${ENV})`);
});
