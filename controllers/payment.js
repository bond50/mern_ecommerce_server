const Product = require('../models/product')
const Cart = require('../models/cart')
const User = require("../models/user");
const Coupon = require("../models/coupon");
const axios = require('axios').default;
const stripe = require('stripe')(process.env.STRIPE_SECRET)
const paypal = require('paypal-rest-sdk');
const Dollar = require("../models/dollar");
const socketIO = require("../modules/socket");
const {calculateCartTotalInDollar, calDisAmountAndFinalAmount} = require("../helpers/cart");
const {calculateCartTotals} = require("../helpers/calculateCartTotals");


exports.createPaymentIntent = async (req, res) => {
    try {
        const {couponApplied, selectedPaymentMethod} = req.body;
        const totals = await calculateCartTotals(req, res, couponApplied);
        let {payable, discountAmount, totalAfterDiscount, cartTotal} = totals
        const convertAmountToCents = (amount) => {
            return Math.round(amount * 100);
        };
        let paymentIntent
        let stripeClientSecret
        let paypalClientSecret
        if (selectedPaymentMethod === 'Card') {
            try {
                paymentIntent = await stripe.paymentIntents.create({
                    amount: payable,
                    currency: 'USD',
                    payment_method: 'pm_card_visa',
                })
                payable = convertAmountToCents(payable);
                stripeClientSecret = paymentIntent.client_secret
            } catch (e) {
                console.log(e)
            }

        }

        if (selectedPaymentMethod === 'Paypal') {
            paypalClientSecret = process.env.PAYPAL_CLIENT_ID;

        }
        if (selectedPaymentMethod === 'Mpesa') {
            if (couponApplied && totalAfterDiscount) {
                payable = totalAfterDiscount
                discountAmount = cartTotal - totalAfterDiscount
            } else {
                payable = cartTotal
                discountAmount = 0
            }

        }

        res.send({
            stripeClientSecret,
            paypalClientSecret,
            cartTotal,
            totalAfterDiscount,
            discountAmount,
            payable,
        })
    } catch (e) {
        console.log(e)
    }
};


exports.lipaNaMpesaOnlineCallback = async = (req, res) => {
    const io = socketIO.getIO();
    const transactionDetails = req.body
    const {
        ResultCode,
        ResultDesc,
        CheckoutRequestID,
        MerchantRequestID,
        CallbackMetadata
    } = transactionDetails.stkCallback


    if (!CallbackMetadata) {
        io.emit('failedMpesa', ResultDesc);
    }

    if (CallbackMetadata) {
        io.emit('succeedMpesa', ResultDesc);
        // const phone = CallbackMetadata.Item[4].Value
        // const amount = CallbackMetadata.Item[0].Value
        // const transactionCode = CallbackMetadata.Item[1].Value


    }

    return res.json('ok')


}


