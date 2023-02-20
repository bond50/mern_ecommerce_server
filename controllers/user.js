const Product = require('../models/product')
const Cart = require('../models/cart')
const User = require("../models/user");
const Coupon = require("../models/coupon");
const Temp = require("../models/temp");
const Counter = require("../models/counter");
const ShortUniqueId = require('short-unique-id');
const sharedModule = require("../helpers/shared-safa-module");
const {formatPhoneNumber} = require("../helpers/phoneFormater");
const moment = require('moment');
const axios = require("axios");
const Order = require("../models/order");
const Dollar = require("../models/dollar");
const paypal = require("@paypal/checkout-server-sdk")
const socketIO = require("../modules/socket");
const Decimal = require('decimal.js');
const {
    calculateCartTotalInDollar,
    getCartWithProductName
} = require("../helpers/cart");

const {convertPriceToDollar} = require("../helpers/priceToDollar");
const {calculateCartTotals} = require("../helpers/calculateCartTotals");


const Environment =
    process.env.NODE_ENV === "production"
        ? paypal.core.LiveEnvironment
        : paypal.core.SandboxEnvironment

const paypalClient = new paypal.core.PayPalHttpClient(
    new Environment(
        process.env.PAYPAL_CLIENT_ID,
        process.env.PAYPAL_CLIENT_SECRET
    )
)

exports.userCart = async (req, res) => {
    const {cart} = req.body
    let products = []
    const user = await User.findById(req.auth._id).exec()
    const cartExistsByThisUser = await Cart.findOne({orderedBy: user._id}).exec()

    if (cartExistsByThisUser) {
        await cartExistsByThisUser.remove()
    }

    for (let i = 0; i < cart.length; i++) {
        let productsObject = {}
        productsObject.product = cart[i]._id
        productsObject.count = cart[i].count
        let p = await Product.findById(cart[i]._id).select('price').exec()
        products.push(productsObject)
        productsObject.price = p.price
    }


    // using for i loop
    // let cartTotal = 0
    // for (let i = 0; i < products.length; i++) {
    //     cartTotal = cartTotal + (products[i].price * products[i].count)
    // }
    // console.log(JSON.stringify(cartTotal, null, 4))

    //using reduce method
    const cartTotal = products.reduce((sum, i) => sum + (i.price * i.count), 0)
    const orderedBy = user._id
    const savedCart = await new Cart({products, cartTotal, cartTotalKES: cartTotal, orderedBy}).save()
    res.json({ok: true})

    // console.log(JSON.stringify(savedCart, null, 4))

}

exports.getUserCart = async (req, res) => {
    const user = await User.findById(req.auth._id).exec()
    const cart = await Cart.findOne({orderedBy: user._id})
        .populate('products.product', '_id title price totalAfterDiscount')
        .exec()
    if (!cart) {
        return res.status(400).json({msg: 'No cart found'});
    }
    const {products, cartTotal, totalAfterDiscount} = cart
    res.json({products, cartTotal, totalAfterDiscount})


}
exports.emptyCart = async (req, res) => {
    const user = await User.findById(req.auth._id).exec()
    const cart = await Cart.findOneAndRemove({orderedBy: user._id}).exec()
    res.json(cart)


}
exports.saveAddress = async (req, res) => {
    const {place, address} = req.body
    const {streetAddress, city, state, zipCode, country, name, lat, lng, googlePlaceId} = address

    console.log('PLACE', place)

    try {
        const newAddress = {
            streetAddress,
            city,
            place,
            state,
            zipCode,
            country,
            name,
            lat,
            lng,
            googlePlaceId
        };

        const userId = req.auth._id;
        const user = await User.findOne({_id: userId});
        if (!user) {
            return res.status(400).json({msg: 'User not found'});
        }
        let addressIndex = -1;
        user.address.forEach((address, index) => {
            if (googlePlaceId === newAddress.googlePlaceId) {
                addressIndex = index;
            }
        });

        if (addressIndex === -1) {
            await User.updateOne({_id: userId}, {$push: {address: newAddress, place}}, {new: true});
        } else {
            user.address[addressIndex].streetAddress = newAddress.streetAddress;
            user.address[addressIndex].city = newAddress.city;
            user.address[addressIndex].place = newAddress.place;
            user.address[addressIndex].lat = newAddress.lat;
            user.address[addressIndex].lng = newAddress.lng;
            user.address[addressIndex].state = newAddress.state;
            user.address[addressIndex].zipCode = newAddress.zipCode;
            user.address[addressIndex].country = newAddress.country;
            user.address[addressIndex].googlePlaceId = newAddress.googlePlaceId;
            await user.save();
        }
        const updatedUser = await User.findOne({_id: userId}).sort({updatedAt: -1}).exec();
        res.status(200).json({ok: true, address: updatedUser.address});
    } catch (error) {
        console.error(error.message);
        res.status(500).send('Server Error');
    }

}
exports.verifyTokenController = (req, res) => {
    res.sendStatus(200);
}
exports.orders = async (req, res) => {
    const user = await User.findById(req.auth._id).exec()
    const userOrders = await Order.find({orderedBy: user._id})
        .select("-shippingAddress -coupon -conversionRate ")
        .populate('products.product')
        .exec()

    let orderArray = []
    userOrders.map(order => {
        let paymentStatus
        if (order.paymentMethod === 'card') {
            paymentStatus = order.paymentIntentStripe.status
        }
        if (order.paymentMethod === 'paypal') {
            paymentStatus = order.paymentResponsePaypal.status
        }

        orderArray.push(
            {
                orderId: order.orderId,
                _id: order._id,
                products: order.products,
                amount: order.totalAmountPaid,
                shippingStatus: order.shippingStatus,
                currencyCode: order.currencyCode,
                paymentMethod: order.paymentMethod,
                paymentStatus: paymentStatus,
                orderDate: order.orderDate,
                orderStatus: order.orderStatus
            },
        )
    })
    console.log(JSON.stringify(orderArray, null, 4))
    res.json(orderArray)


}
exports.addToWishList = async (req, res) => {
    const {productId} = req.body
    await User.findByIdAndUpdate(req.auth._id, {$addToSet: {wishlist: productId}}).exec()
    res.json({ok: true})


}
exports.wishList = async (req, res) => {
    const list = await User.findById(req.auth._id).select('wishlist').populate('wishlist').exec()
    res.json(list)

}

exports.removeFromWishlist = async (req, res) => {
    const {productId} = req.params
    await User.findByIdAndUpdate(req.auth._id, {$pull: {wishlist: productId}}).exec()
    res.json({ok: true})
}
exports.applyCouponToUserCart = async (req, res) => {
    const {coupon, couponUsed} = req.body
    if (couponUsed === false) {
        const validCoupon = await Coupon.findOne({code: coupon}).exec()
        const user = await User.findById(req.auth._id).exec()
        // Check if the coupon exists in the database

        if (!validCoupon) return res.json({err: "Coupon not found"});

        // Check if the coupon has expired

        if (validCoupon.expirationDate < Date.now())
            return res.json({err: "Coupon has expired"});

        if (validCoupon.isValid === false)
            return res.json({err: "Coupon is not valid"});

        // const previousCoupon = await Coupon.findOne({usedBy: user._id});
        // if (previousCoupon) return res.json({err: "You can only use one coupon per purchase"});
        const cart = await Cart.findOne({orderedBy: user._id}).populate('products.product', '_id title price').exec()

        const {cartTotal} = cart

        //recalculate total after discount
        const discountedAmount = (cartTotal * (validCoupon.discount / 100)).toFixed(2)
        let totalAfterDiscount = (cartTotal - discountedAmount)
        await Cart.findOneAndUpdate({orderedBy: user._id}, {
            totalAfterDiscount,
            totalAfterDiscountKES: totalAfterDiscount,
            coupon: validCoupon._id
        }, {new: true}).exec()
        res.json({totalAfterDiscount, ok: true})
    }


}


exports.createOrder = async (req, res) => {
    const {
        shippingAddress,
        shippingCost,
        paymentIntent,
        couponApplied,
        selectedPaymentMethod
    } = req.body;

    const user = await User.findById(req.auth._id).exec();
    const cart = await Cart.findOne({orderedBy: user._id}).populate({path: "products.product", select: "title"}).exec();
    const {products, coupon, cartTotal, totalAfterDiscount} = cart;
    const dollar = await Dollar.findOne({});

    let finalAmount
    if (couponApplied && totalAfterDiscount) {
        finalAmount = totalAfterDiscount
    } else {
        finalAmount = cartTotal
    }

    let convertedFinalAmount
    convertedFinalAmount = (dollar.rate * finalAmount)


    if (selectedPaymentMethod === 'Paypal') {
        const Environment =
            process.env.NODE_ENV === "production"
                ? paypal.core.LiveEnvironment
                : paypal.core.SandboxEnvironment

        const paypalClient = new paypal.core.PayPalHttpClient(
            new Environment(
                process.env.PAYPAL_CLIENT_ID,
                process.env.PAYPAL_CLIENT_SECRET
            )
        )

        const request = new paypal.orders.OrdersCreateRequest()
        request.prefer("return=representation")
        request.requestBody({
            intent: "CAPTURE",
            application_context: {
                brand_name: "myFarm",
                landing_page: "BILLING",
                user_action: "CONTINUE",
            },
            purchase_units: [{
                reference_id: user._id,
                description: "payment for XY company",
                soft_descriptor: "Jewlery Fashion",

                amount: {
                    currency_code: "USD",
                    value: finalAmount,
                    breakdown: {
                        item_total: {
                            currency_code: "USD",
                            value: finalAmount,
                        },
                    },
                },
                items: products.map(item => {
                    console.log(item.price)
                    return {
                        name: item.product.title,
                        unit_amount: {
                            currency_code: "USD",
                            value: item.price,
                        },
                        quantity: item.count,
                    }
                }),
            },
            ]
        })

        try {
            const order = await paypalClient.execute(request)
            res.json({id: order.result.id})

        } catch (e) {

            res.status(500).json({error: e.message})
        }


    }
    if (selectedPaymentMethod === 'Card') {
        const newOrder = await new Order({
            products,
            paymentResponsePaypal: order.result,
            orderedBy: user._id,
            paymentMethod: selectedPaymentMethod.toLowerCase(),
            shippingAddress,
            totalAmountPaid: payable,
            deliveryEndDate,
            deliveryStartDate,
            coupon,
            cartTotal,
            discountAmount
        }).save();

        // Decrement quantity, increment sold
        const bulkOption = products.map((item) => {
            return {
                updateOne: {
                    filter: {_id: item.product._id},
                    update: {$inc: {quantity: -item.count, sold: item.count}},
                },
            };
        });
        await Product.bulkWrite(bulkOption, {new: true});
        const today = new Date();
        const deliveryStartDate = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000)
        const deliveryEndDate = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);
        if (coupon) {
            const validCoupon = await Coupon.findById(coupon).exec();
            validCoupon.usedForPurchase = true;
            validCoupon.usageCount += 1;
            validCoupon.usedBy.push(user._id);
            await validCoupon.save();
        }


    }


};

exports.initiateMpesaOrder = async (req, res) => {
    const timestamp = moment().format('YYYYMMDDHHmmss');
    console.log('TIMESTAMP', timestamp)
    const shortCode = 174379;
    const passkey = process.env.SAFARICOM_PASS_KEY;
    const url = "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest";
    const phone = `254${req.body.phoneNumber}`
    const password = new Buffer.from(shortCode + passkey + timestamp).toString("base64");
    const data = {
        BusinessShortCode: 174379,
        Password: password,
        Timestamp: timestamp,
        TransactionType: "CustomerPayBillOnline",
        Amount: 1,
        PartyA: phone,
        PartyB: 174379,
        PhoneNumber: phone,
        CallBackURL: "https://galavuwal.co.ke/callback",
        AccountReference: "CompanyXLTD",
        TransactionDesc: "TPayment of X",
    };
    console.log(data)
    try {
        const result = await axios.post(url, data,
            {
                headers:
                    {
                        authorization: `Bearer ${req.daraja.access_token}`
                    }
            })
        console.log(JSON.stringify(result.data))
        res.json(result.data)

    } catch (error) {
        // handle error
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error(error.response.data);
            console.error(error.response.status);
            console.error(error.response.headers);
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
            console.error(error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error', error.message);
        }
        console.error(error.config);
    }

}
exports.initiatePayPal = async (req, res) => {
    const {couponApplied} = req.body;
    const totals = await calculateCartTotals(req, res, couponApplied);
    let {payable, discountAmount} = totals

    try {
        const user = await User.findById(req.auth._id).exec();
        const populatedCart = await getCartWithProductName(user._id);
        const {products} = populatedCart
        const dollar = await Dollar.findOne({});

        const items = products.map(item => {
            return {
                name: item.product.title || "Item",
                unit_amount: {
                    currency_code: "USD",
                    value: convertPriceToDollar(item.price, dollar.rate).toFixed(2),
                },
                quantity: item.count,
            };
        });
        let itemTotal = calculateCartTotalInDollar(items, dollar.rate).toFixed(2);

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer("return=representation");
        request.requestBody({
            intent: "CAPTURE",
            application_context: {
                brand_name: process.env.APP_NAME,
            },
            purchase_units: [
                {
                    reference_id: user._id,
                    description: `payment for ${process.env.APP_NAME}`,
                    soft_descriptor: `${process.env.APP_NAME}`,

                    amount: {
                        currency_code: "USD",
                        value: payable,
                        breakdown: {
                            item_total: {
                                currency_code: "USD",
                                value: itemTotal,
                            },
                            discount: {
                                currency_code: "USD",
                                value: discountAmount,
                            }
                        },
                    },
                    items,
                },
            ]
        });
        const order = await paypalClient.execute(request)
        res.json({id: order.result.id})

    } catch (e) {
        res.status(500).json({error: e.message})
        console.error(e.message)
    }
}
exports.getMpesaDetails = async (req, res) => {
    const request = require('request');

    const consumerKey = process.env.SAFARICOM_CONSUMER_KEY;
    const consumerSecret = process.env.SAFARICOM_CONSUMER_SECRET;
    const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const transactionId = 'ws_CO_17022023064425754708374149';
    const shortcode = process.env.SAFARICOM_SHORT_CODE;
    const url = `https://api.safaricom.co.ke/mpesa/transactionstatus/v1/query?transactionID=${transactionId}&shortCode=${shortcode}&passkey=${process.env.SAFARICOM_PASS_KEY}`;
    console.log(req.daraja.access_token)
    const options = {
        url: url,
        headers: {
            authorization: `Bearer ${req.daraja.access_token}`
        }
    };

    request.get(options, (error, response, body) => {
        if (error) {
            console.error(error);

        } else {
            const data = JSON.parse(body);
            res.json(data)
            console.log(data);
        }
    });


}

exports.createStripeOrder = async (req, res) => {
    const {
        shippingAddress,
        paymentIntent,
        couponApplied,
        selectedPaymentMethod
    } = req.body;
    try {
        const user = await User.findById(req.auth._id).exec();
        const cart = await Cart.findOne({orderedBy: user._id}).exec();
        const {products, coupon, dollar, currencyCode, cartTotal, discountAmount} = cart;
        const now = new Date()
        const deliveryStartDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
        const deliveryEndDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

        const newOrder = await new Order({
            products,
            paymentIntentStripe: paymentIntent,
            orderedBy: user._id,
            paymentMethod: selectedPaymentMethod.toLowerCase(),
            shippingAddress,
            totalAmountPaid: paymentIntent.amount / 100,
            deliveryEndDate,
            currencyCode,
            conversionRate: dollar,
            deliveryStartDate,
            coupon,
            cartTotal,
            discountAmount
        }).save();
        const bulkOption = products.map((item) => {
            return {
                updateOne: {
                    filter: {_id: item.product._id},
                    update: {$inc: {quantity: -item.count, sold: item.count}},
                },
            };
        });
        await Product.bulkWrite(bulkOption, {new: true});
        if (coupon) {
            const validCoupon = await Coupon.findById(coupon).exec();
            validCoupon.usedForPurchase = true;
            validCoupon.usageCount += 1;
            validCoupon.usedBy.push(user._id);
            await validCoupon.save();
        }
        console.log('USER', user)

        const data = {
            name: `${user.firstName} ${user.middleName} ${user.surname}`,
            email: user.email,
            transactionId: paymentIntent.id,
            transactionDate: paymentIntent.created * 1000,
            transactionAmount: paymentIntent.amount / 100
        }

        res.json({result: data, saved: newOrder});

    } catch (err) {
        // Handle any errors from the call
        console.error(err);
        return res.send(500);
    }


}
exports.capturePayPalPaymentAndSavePaypalOrder = async (req, res) => {
    const {orderId, selectedPaymentMethod, shippingAddress} = req.body;
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    try {
        const user = await User.findById(req.auth._id).exec();
        const cart = await Cart.findOne({orderedBy: user._id}).exec();

        const {products, coupon, dollar, currencyCode, cartTotalUSD, discountAmountUSD} = cart;

        const capture = await paypalClient.execute(request);

        const result = capture.result;
        //SAVE ORDER TO DB
        if (result) {
            const now = new Date()
            const deliveryStartDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)
            const deliveryEndDate = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);
            const newOrder = await new Order({
                products,
                paymentResponsePaypal: result,
                orderedBy: user._id,
                paymentMethod: selectedPaymentMethod.toLowerCase(),
                shippingAddress,
                totalAmountPaid: result.purchase_units[0].payments.captures[0].amount.value,
                deliveryEndDate,
                currencyCode,
                conversionRate: dollar,
                deliveryStartDate,
                coupon,
                cartTotal: cartTotalUSD,
                discountAmount: discountAmountUSD
            }).save();


            // Decrement quantity, increment sold
            const bulkOption = products.map((item) => {
                return {
                    updateOne: {
                        filter: {_id: item.product._id},
                        update: {$inc: {quantity: -item.count, sold: item.count}},
                    },
                };
            });
            await Product.bulkWrite(bulkOption, {new: true});
            if (coupon) {
                const validCoupon = await Coupon.findById(coupon).exec();
                validCoupon.usedForPurchase = true;
                validCoupon.usageCount += 1;
                validCoupon.usedBy.push(user._id);
                await validCoupon.save();
            }
            res.json({result, saved: newOrder});
        }
        // return capture.result;
    } catch (err) {
        // Handle any errors from the call
        console.error(err);
        return res.send(500);
    }

}



