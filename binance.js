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

function balance() {
    try {
        binance.balance((error, balances) => {
            if (error !== null) throw new Error(error);
            else openOrders(balances)
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, refresh)).finally(() => main());
    }
}

function openOrders(balances) {
    try {
        binance.openOrders(undefined, (error, orders) => {
            if (error !== null) throw new Error(error);
            else exchangeInfo(balances, orders)
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, refresh)).finally(() => main());
    }
}

function exchangeInfo(balances, orders) {
    try {
        binance.exchangeInfo((error, exchangeInfo) => {
            if (error !== null) throw new Error(error);
            else candlesticks(Object.entries(exchangeInfo['symbols']).filter(([, value]) =>
                value.symbol.endsWith('USDT')
                && !value.symbol.endsWith('DOWNUSDT')
                && !value.symbol.endsWith('UPUSDT')
                && !value.symbol.endsWith('BULLUSDT')
                && !value.symbol.endsWith('BEARUSDT')
                && value.status !== 'BREAK'), balances, orders)
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, refresh)).finally(() => main());
    }
}

function candlesticks(currencies, balances, orders) {
    try {
        let counter = 0
        Object.entries(currencies).forEach(function ([, [, value]]) {
            binance.candlesticks(value.symbol, interval, (error, res) => {
                if (error !== null) throw new Error(error);
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

                    if (++counter === currencies.length) noOrders(balances, currencies, orders)
                }
            }, {limit: limit})
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, refresh)).finally(() => main());
    }
}

function noOrders(balances, currencies, orders) {
    try {
        let counter = 0, total = 0
        Object.entries(currencies).forEach(function ([, [, value]]) {
            if (balances[value['baseAsset']].available * value.price >= 1
                && value['baseAsset'] !== 'BNB')
                console.error(value.symbol + ' has units out of order: '
                    + (balances[value['baseAsset']].available * value.price) + '$')

            total += value.price * Number(balances[value['baseAsset']].available)
            total += value.price * Number(balances[value['baseAsset']].onOrder)

            if (++counter === currencies.length) buyLimit(currencies, balances, orders, total)
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, refresh)).finally(() => main());
    }
}

function buyLimit2(currencies, new_orders, total, details, balances, orders, mise) {
    try {
        let counter = 0;
        Object.entries(currencies).forEach(function ([, [, [, value]]]) {

            let volume = String(mise / value.price)
            volume = volume.substr(0, volume.split('.')[0].length
                + (value.lenVol ? 1 : 0) + value.lenVol)

            let price = String(value.price * profit / 100)
            price = price.substr(0, price.split('.')[0].length
                + (value.lenPrice ? 1 : 0) + value.lenPrice)

            binance.marketBuy(value.symbol, volume, (error,) => {
                if (error !== null) {
                    let responseJson = JSON.parse(error.body)
                    if (parseInt(responseJson.code) === -2010)
                        console.log(value.symbol + " [" + responseJson.code + "]: "
                            + responseJson["msg"] + " " + price + " " + volume)
                    else console.error(value.symbol + " [" + responseJson.code + "]: "
                            + responseJson["msg"] + " " + price + " " + volume)
                    new Promise(res => setTimeout(res, refresh)).finally(() => main());
                } else {
                    console.log(value.symbol + " buy")
                    binance.sell(value.symbol, volume, price, {type: 'LIMIT'}, (error,) => {
                        if (error !== null) {
                            let responseJson = JSON.parse(error.body)
                            console.error(value.symbol + " [" + responseJson.code + "]: "
                                + responseJson["msg"] + " " + price + " " + volume)
                            new Promise(res => setTimeout(res, refresh)).finally(() => main());
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

                            balances["USDT"].available -= mise

                            if (++counter === currencies.length)
                                output(details, new_orders, currencies, balances, orders, total)
                        }
                    })
                }
            })
        });
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, refresh)).finally(() => main());
    }
}

function buyLimit(currencies, balances, openOrders, total) {
    try {
        total += Number(balances["USDT"].available)
        total += Number(balances["USDT"].onOrder)

        let  curr = [], details = [], new_orders = [], orders = []
        let counter = 0, mise = total * 4 / 100;

        Object.entries(openOrders).forEach(function ([, value]) {
            let curr = Object.entries(currencies).filter(([, [, val]]) => val.symbol === value.symbol)[0][1][1]
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
                    detail.amprice = Number((((value.price - (value.moy * (100 - a_median) / 100))
                        / (value.moy * (100 - a_median) / 100)) * 100).toFixed(2))
                    details.push(detail)

                    value.amprice = detail.amprice
                }

                if (value.moy * (100 - b_median) / 100 > value.price
                    || value.moy * (100 - a_median) / 100 < value.price
                    || value.price <= 0 || prc < 10 || prcm < 10)
                    curr = Object.entries(currencies).filter(([, [, val]]) => val.symbol !== value.symbol)
            }

            if (++counter === currencies.length) {
                curr = curr.filter(([, [, val]]) => val.amprice <= 0).sort((a, b) => a.amprice - b.amprice).slice(0, 30)
                if (curr.length > 0)
                    buyLimit2(curr, new_orders, total, details, balances, orders, mise)
                else
                    output(details, new_orders, currencies, balances, orders, total)
            }
        });
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, refresh)).finally(() => main());
    }
}

function output(details, new_orders, currencies, balances, orders, total) {
    if (details.length > 0) console.table(details.sort((a, b) => a.amprice - b.amprice).slice(0, 14).reverse())
    if (orders.length > 0) console.table(orders.sort((a, b) => b.plusValue - a.plusValue))
    if (new_orders.length > 0) console.table(new_orders)
    console.table({
        'Balance': {
            'Available': Number(Number(balances["USDT"].available).toFixed(2)),
            'Total': Number((Number(total)).toFixed(2))
        }
    })

    new Promise(res => setTimeout(res, refresh)).finally(() => main());
}

const average = arr => arr.reduce((p, c) => p + c, 0) / arr.length,
    interval = "15m", limit = 673,
    a_median = 0, b_median = 20,
    profit = 110, keep_balance = 0,
    refresh = 20000;

function main() {
    balance();
}

main()
