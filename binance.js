const secrets = require('./secrets');

const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: secrets.binance_key(),
    APISECRET: secrets.binance_secret()
});

function getDate(date = new Date()) {
    return date.getFullYear() + "-"
        + (String(date.getUTCMonth()).length === 1 ? ("0" + (date.getMonth() + 1)) : (date.getMonth() + 1)) + "-"
        + (String(date.getDate()).length === 1 ? ("0" + date.getDate()) : date.getDate()) + " "
        + (String(date.getHours()).length === 1 ? ("0" + date.getHours()) : date.getHours()) + "-"
        + (String(date.getMinutes()).length === 1 ? ("0" + date.getMinutes()) : date.getMinutes()) + "-"
        + (String(date.getSeconds()).length === 1 ? ("0" + date.getSeconds()) : date.getSeconds())
}

function order(currency, volume, stopLoss, openValue, nowValue, timestamp, plusValue) {
    const order = Object.create(null)
    order.currency = currency
    order.volume = Number(volume)
    order.stopLoss = Number(stopLoss)
    order.openValue = Number(openValue)
    order.nowValue = Number(nowValue)
    order.date = getDate(new Date(timestamp))
    order.plusValue = Number(plusValue.toFixed(2))
    return order
}

const average = arr => arr.reduce((p, c) => p + c, 0) / arr.length,
    interval = "15m", limit = 673,
    a_median = 0, b_median = 20,
    mise = 120, profit = 110,
    keep_balance = 0;

function main() {
    new Promise(function (resolve, reject) {
        try {
            binance.balance((error, balances) => {
                if (error !== null)
                    reject(Error(error));
                else {
                    openOrders(balances)
                    resolve();
                }
            })
        } catch (err) {
            console.error(err)
            new Promise(res => setTimeout(res, 10000)).finally(() => main());
        }
    }).catch(e => console.error(e))
}

function openOrders(balances) {
    new Promise(function (resolve, reject) {
        binance.openOrders(undefined, (error, orders) => {
            if (error !== null)
                reject(Error(error));
            else {
                exchangeInfo(balances, orders)
                resolve();
            }
        })
    }).catch(e => {
        console.error(e)
        new Promise(res => setTimeout(res, 10000)).finally(() => main());
    })
}

function exchangeInfo(balances, orders) {
    new Promise(function (resolve, reject) {
        binance.exchangeInfo((error, exchangeInfo) => {
            if (error !== null)
                reject(Error(error));
            else {
                let currencies = Object.entries(exchangeInfo['symbols']).filter(([, value]) => value.symbol.endsWith('USDT')
                    && !value.symbol.endsWith('DOWNUSDT')
                    && !value.symbol.endsWith('UPUSDT')
                    && !value.symbol.endsWith('BULLUSDT')
                    && !value.symbol.endsWith('BEARUSDT')
                    && value.status !== 'BREAK')
                candlesticks(currencies, balances, orders)
                resolve(true);
            }
        })
    }).catch(e => {
        console.error(e)
        new Promise(res => setTimeout(res, 10000)).finally(() => main());
    })
}

function candlesticks(currencies, balances, orders) {
    new Promise(function (resolve, reject) {
        let counter = 0
        Object.entries(currencies).forEach(function ([, [, value]]) {
            binance.candlesticks(value.symbol, interval, (error, res) => {
                if (error !== null)
                    reject(Error(error));
                else {
                    value.moy = []
                    res.forEach(function (val) {
                        value.moy.push(Number(val[4]))
                    })
                    value.price = value.moy[value.moy.length - 1]

                    let minPrice = (value['filters'].filter(val => val['filterType'] === 'PRICE_FILTER'))[0]
                    let minVolume = (value['filters'].filter(val => val['filterType'] === 'LOT_SIZE'))[0]
                    value.lenPrice = minPrice.minPrice.split('.')[0] === "0"
                        ? (minPrice.minPrice.split('.')[1].split('1')[0] + '1').length : 0
                    value.lenVol = minVolume.minQty.split('.')[0] === "0"
                        ? (minVolume.minQty.split('.')[1].split('1')[0] + '1').length : 0

                    if (++counter === currencies.length) {
                        noOrders(balances, currencies, orders)
                        resolve(true);
                    }
                }
            }, {limit: limit})
        })
    }).catch(e => {
        console.error(e)
        new Promise(res => setTimeout(res, 10000)).finally(() => main());
    })
}

function noOrders(balances, currencies, orders) {
    new Promise(function (resolve,) {
        let counter = 0
        Object.entries(currencies).forEach(([, [, value]]) => {
            if (balances[value['baseAsset']].available * value.price >= 1
                && value['baseAsset'] !== 'BNB')
                console.error(value.symbol + ' has units out of order: '
                    + (balances[value['baseAsset']].available * value.price) + '$')

            if (++counter === Object.entries(currencies).length) {

                buyLimit(currencies, balances, orders)
                resolve(true);
            }
        })
    }).catch(e => {
        console.error(e)
        new Promise(res => setTimeout(res, 10000)).finally(() => main());
    })
}

function buyLimit(currencies, balances, orders) {
    new Promise(function (resolve,) {
        let details = [], new_orders = []
        let counter = 0, total = 0
        Object.entries(currencies).forEach(function ([, [, value]]) {

            if (Number(balances[value['baseAsset']].onOrder) === 0
                && Number(balances[value['baseAsset']].available) === 0
                && Number(balances["USDT"].available) >= (keep_balance + mise)) {

                let min = Math.min.apply(null, value.moy)
                let max = Math.max.apply(null, value.moy)
                value.moy = average(value.moy)
                let prcm = ((max - value.moy) / value.moy) * 100
                let prc = ((max - min) / min) * 100

                if (prc >= 10 && prcm >= 10) {
                    const detail = Object.create(null)
                    detail.currency = value.symbol
                    detail.price = value.price
                    detail.min = min
                    detail.moy = Number(value.moy.toFixed(3))
                    detail.max = max
                    detail.prc = Number(prc.toFixed(0))
                    detail.prcm = Number(prcm.toFixed(0))
                    detail.bm = Number((value.moy * (100 - b_median) / 100).toFixed(6))
                    detail.am = Number((value.moy * (100 - a_median) / 100).toFixed(6))
                    detail.amprice = Number(((value.price - (value.moy * (100 - a_median) / 100))
                        / (value.moy * (100 - a_median) / 100)) * 100).toFixed(2)
                    details.push(detail)
                }

                if (value.moy * (100 - b_median) / 100 <= value.price &&
                    value.moy * (100 - a_median) / 100 >= value.price &&
                    value.price > 0 && prc >= 10 && prcm >= 10) {

                    let volume = String(mise / value.price)
                    volume = volume.substr(0, volume.split('.')[0].length
                        + (value.lenVol ? 1 : 0) + value.lenVol)

                    let price = String(value.price * profit / 100)
                    price = price.substr(0, price.split('.')[0].length
                        + (value.lenPrice ? 1 : 0) + value.lenPrice)

                    binance.marketBuy(value.symbol, volume, (error,) => {
                        if (error !== null) {
                            let responseJson = JSON.parse(error.body)
                            console.error(value.symbol + " [" + responseJson.code + "]: "
                                + responseJson["msg"] + " " + price + " " + volume)
                        } else {
                            console.log(value.symbol + " buy")
                            balances["USDT"].available -= mise
                            binance.sell(value.symbol, volume, price, {type: 'LIMIT'}, (error,) => {
                                if (error !== null) {
                                    let responseJson = JSON.parse(error.body)
                                    console.error(value.symbol + " [" + responseJson.code + "]: "
                                        + responseJson["msg"] + " " + price + " " + volume)
                                } else {
                                    console.log(value.symbol + " sell")

                                    new_orders.push(order(
                                        value.symbol,
                                        volume,
                                        price,
                                        value.price,
                                        value.price,
                                        Date.now(),
                                        0
                                    ))
                                    total += mise
                                }
                            })
                        }
                    })
                }
            }

            total += value.price * Number(balances[value['baseAsset']].available)
            total += value.price * Number(balances[value['baseAsset']].onOrder)

            if (++counter === Object.entries(currencies).length) {
                output(details, new_orders, currencies, balances, orders, total)
                resolve();
            }
        });
    }).catch(e => {
        console.error(e)
        new Promise(res => setTimeout(res, 10000)).finally(() => main());
    })
}

function output(details, new_orders, currencies, balances, openOrders, total) {
    if (details.length > 0) console.table(details.sort(
        (a, b) => a.amprice - b.amprice).slice(0, 14).reverse())

    let orders = []
    Object.entries(openOrders).forEach(([, value]) => {
        let curr = currencies.filter(([, val]) => val.symbol === value.symbol)[0][1]
        orders.push(order(
            value.symbol,
            value['origQty'],
            value.price,
            (value.price / (profit / 100)).toPrecision(String(Number(value.price)).length),
            curr.price,
            value['time'],
            100 - ((value.price - curr.price) / curr.price) * 100
        ))
    })

    console.table(orders.sort((a, b) => b.plusValue - a.plusValue))
    if (new_orders.length > 0) console.table(new_orders)
    console.table({
        'Balance': {
            'Available': Number(Number(balances["USDT"].available).toFixed(2)),
            'Total': Number((Number(total) + Number(balances["USDT"].available)).toFixed(2))
        }
    })

    new Promise(res => setTimeout(res, 10000)).finally(() => main());
}

main()
