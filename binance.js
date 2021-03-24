const binSecret = require('./config/secrets');
const config = require('./config/config');
const func = require('./class/func');

const Binance = require('node-binance-api');
const binance = new Binance().options({
    APIKEY: binSecret.key(),
    APISECRET: binSecret.secret()
});

// get balance of account
function gB() {
    try {
        binance.balance((error, balances) => {
            if (error !== null) new Error(error);
            else gOO(balances)
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, config.refresh())).finally(() => gB());
    }
}

// get open order
function gOO(balances) {
    try {
        binance.openOrders(undefined, (error, orders) => {
            if (error !== null) new Error(error);
            else gC(balances, orders)
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, config.refresh())).finally(() => gB());
    }
}

// get currencies available
function gC(balances, orders) {
    try {
        binance.exchangeInfo((error, exchangeInfo) => {
            if (error !== null) new Error(error);
            else gH(Object.entries(exchangeInfo['symbols']).filter(([, value]) =>
                value.symbol.endsWith(config.baseMoney())
                && !value.symbol.endsWith('DOWN' + config.baseMoney())
                && !value.symbol.endsWith('UP' + config.baseMoney())
                && !value.symbol.endsWith('BULL' + config.baseMoney())
                && !value.symbol.endsWith('BEAR' + config.baseMoney())
                && value.status !== 'BREAK'), balances, orders)
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, config.refresh())).finally(() => gB());
    }
}

// get history per currency
function gH(currencies, balances, orders) {
    try {
        let counter = 0
        Object.entries(currencies).forEach(function ([, [, value]]) {
            binance.candlesticks(value.symbol, config.interval()[0], (error, res) => {
                if (error !== null) new Error(error);
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

                    if (++counter === currencies.length) gNO(balances, currencies, orders)
                }
            }, {limit: config.interval()[1]})
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, config.refresh())).finally(() => gB());
    }
}

// get currency without order
function gNO(balances, currencies, orders) {
    try {
        let counter = 0, total = 0
        Object.entries(currencies).forEach(function ([, [, value]]) {
            if (balances[value['baseAsset']].available * value.price >= config.noOrder()
                && value['baseAsset'] !== config.feeMoney())
                console.error(value.symbol + ' has units out of order: '
                    + (balances[value['baseAsset']].available * value.price) + config.baseSymbol())

            total += value.price * Number(balances[value['baseAsset']].available)
            total += value.price * Number(balances[value['baseAsset']].onOrder)

            if (value.symbol === config.feeMoney() + config.baseMoney())
                balances[config.feeMoney()].available *= value.price

            if (++counter === currencies.length)
                pB(currencies, balances, orders, total)
        })
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, config.refresh())).finally(() => gB());
    }
}

// buy currency
function bL(currencies, curr, new_orders, total, details, BuyNb, balances, orders, mise, open, now, want) {
    try {
        let counter = 0;
        Object.entries(curr).forEach(function ([, value]) {

            let volume = String(mise / value.price)
            volume = volume.substr(0, volume.split('.')[0].length
                + (value.lenVol ? 1 : 0) + value.lenVol)

            let price = String(value.price * (config.profit() / 100 + 1))
            price = price.substr(0, price.split('.')[0].length
                + (value.lenPrice ? 1 : 0) + value.lenPrice)

            value.price = String(value.price * volume)
            value.price = value.price.substr(0, value.price.split('.')[0].length
                + (value.lenPrice ? 1 : 0) + value.lenPrice)

            if (balances[config.feeMoney()].available > (value.price * config.feeValue() / 100)) {
                open += Number(value.price)
                now += Number(value.price)
                want += Number(price * volume)

                binance.marketBuy(value.symbol, volume, (error,) => {
                    if (error !== null) {
                        let responseJson = JSON.parse(error.body)
                        console.error(value.symbol + " [" + responseJson.code + "]: " + responseJson["msg"] + " " + price
                            + " " + volume)
                    } else {
                        binance.sell(value.symbol, volume, price, {type: 'LIMIT'}, (error,) => {
                            if (error !== null) {
                                let responseJson = JSON.parse(error.body)
                                console.error(value.symbol + " [" + responseJson.code + "]: "
                                    + responseJson["msg"] + " " + price + " " + volume)
                            } else {
                                new_orders.push(func.order(
                                    value.symbol,
                                    volume,
                                    price * volume,
                                    value.price,
                                    value.price,
                                    Date.now(),
                                    0
                                ))

                                balances[config.baseMoney()].available -= mise
                                balances[config.feeMoney()].available -= value.price * config.feeValue() / 100

                                if (++counter === curr.length)
                                    gO(currencies, curr, details, new_orders, balances, orders, total, open, now, want)
                            }
                        })
                    }
                })
            } else {
                gO(currencies, curr, details, new_orders, balances, orders, total, open, now, want)
                console.error("Veuillez acheter du " + config.feeMoney() + " pour les frais")
            }
        });
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, config.refresh())).finally(() => gB());
    }
}

// Remove cryptocurrencies that do not match the purchase condition
function pB(currencies, balances, openOrders, total) {
    try {

        total += Number(balances[config.baseMoney()].available)
        total += Number(balances[config.baseMoney()].onOrder)

        let curr = [], details = [], new_orders = [], orders = []
        let counter = 0, open = 0, now = 0, want = 0, mise = total * config.mise() / 100;

        Object.entries(openOrders).forEach(function ([, value]) {
            let curr = Object.entries(currencies).filter(([, [, val]]) => val.symbol === value.symbol)[0][1][1]

            let volume = String(value['origQty'])
            volume = volume.substr(0, volume.split('.')[0].length
                + (curr.lenVol ? 1 : 0) + curr.lenVol)

            let openValue = String(value.price / (config.profit() / 100 + 1) * value['origQty'])
            openValue = openValue.substr(0, openValue.split('.')[0].length
                + (curr.lenPrice ? 1 : 0) + curr.lenPrice)

            let nowValue = String(curr.price * value['origQty'])
            nowValue = nowValue.substr(0, nowValue.split('.')[0].length
                + (curr.lenPrice ? 1 : 0) + curr.lenPrice)

            let wantValue = String(value.price * value['origQty'])
            wantValue = wantValue.substr(0, wantValue.split('.')[0].length
                + (curr.lenPrice ? 1 : 0) + curr.lenPrice)

            open += Number(openValue)
            now += Number(nowValue)
            want += Number(wantValue)

            orders.push(func.order(
                value.symbol,
                volume,
                wantValue,
                openValue,
                nowValue,
                value['time'],
                (curr.price - value.price / (config.profit() / 100 + 1)) / value.price / (config.profit() / 100 + 1) * 100
            ))
        })

        Object.entries(currencies).forEach(function ([, [, value]]) {

            if (Number(balances[value['baseAsset']].onOrder) === 0
                && Number(balances[value['baseAsset']].available) === 0) {

                let max = Math.max.apply(null, value.moy)
                value.moy = func.lAvg(value.moy)
                let prc = ((max - value.moy) / value.moy) * 100

                if (prc >= config.prc()) {
                    value.amprice = Number((((value.price - (value.moy * (100 - config.median()[0]) / 100))
                        / (value.moy * (100 - config.median()[0]) / 100)) * 100).toFixed(2))

                    if (value.amprice <= 0)
                        details.push(value.symbol)
                }

                if (value.moy * (100 - config.median()[1]) / 100 > value.price
                    || value.moy * (100 - config.median()[0]) / 100 < value.price
                    || value.price <= 0 || prc < 10)
                    curr = Object.entries(currencies).filter(([, [, val]]) => val.symbol !== value.symbol)
            }

            if (++counter === currencies.length) {
                let curr2 = []
                curr = curr.filter(([, [, val]]) => val.amprice <= 0)
                Object.entries(curr).forEach(([, [, [, v]]]) => {
                    curr2.push(v)
                })

                let nbMise = Number(String((Number(balances[config.baseMoney()].available)
                    - config.keep_balance()) / mise).split('.')[0])
                if (nbMise > 0 && (!config.onlyShort() || Number((details.length / currencies.length * 100)
                    .toFixed(0)) >= config.marketPrc())) {
                    curr = curr2.sort((a, b) => a.amprice - b.amprice).slice(0, nbMise <= 29 ? nbMise : 29)
                    if (curr.length > 0)
                        bL(currencies, curr, new_orders, total, details, balances, orders, mise, open, now, want)
                    else gO(currencies, curr, details, new_orders, balances, orders, total, open, now, want)
                } else gO(currencies, curr, details, new_orders, balances, orders, total, open, now, want)
            }
        });
    } catch (err) {
        console.error(err)
        new Promise(res => setTimeout(res, config.refresh())).finally(() => gB());
    }
}

// Return status of orders, balances and cryptos
function gO(currencies, curr, details, new_orders, balances, orders, total, open, now, want) {

    const stateCurrencies = {
        [config.colCrypto()[0]]: {
            [config.colCrypto()[1]]: details.length, [config.colCrypto()[2]]: currencies.length,
            '%': Number((details.length / currencies.length * 100).toFixed(0)),
            [config.colCrypto()[3]]: config.colCrypto()[4] + ' '
            + (Number((details.length / currencies.length * 100).toFixed(0)) >= config.marketPrc() ? config.colCrypto()[5]
                : config.colCrypto()[6])
        }
    }

    const stateBalance = {
        ['Trades (' + config.baseSymbol() + ')']: {
            [config.colResume()[0]]: Number((Number(open)).toFixed(2)),
            [config.colResume()[1]]: Number((Number(now)).toFixed(2)),
            [config.colResume()[2]]: Number((Number(want)).toFixed(2))
        },
        [config.baseMoney() + ' (' + config.baseSymbol() + ')']: {
            [config.colResume()[0]]: Number(Number(balances[config.baseMoney()].available).toFixed(2)),
            [config.colResume()[1]]: Number(Number(balances[config.baseMoney()].available).toFixed(2)),
            [config.colResume()[2]]: Number(Number(balances[config.baseMoney()].available).toFixed(2))
        },
        [config.feeMoney() + ' (' + config.baseSymbol() + ')']: {
            [config.colResume()[0]]: Number(Number(balances[config.feeMoney()].available).toFixed(2)),
            [config.colResume()[1]]: Number(Number(balances[config.feeMoney()].available).toFixed(2)),
            [config.colResume()[2]]: Number(Number(balances[config.feeMoney()].available).toFixed(2))
        },
        ['Total (' + config.baseSymbol() + ')']: {
            [config.colResume()[0]]: Number((Number(open) + Number(balances[config.baseMoney()].available)
                + Number(balances[config.feeMoney()].available)).toFixed(2)),
            [config.colResume()[1]]: Number((Number(now) + Number(balances[config.baseMoney()].available)
                + Number(balances[config.feeMoney()].available)).toFixed(2)),
            [config.colResume()[2]]: Number((Number(want) + Number(balances[config.baseMoney()].available)
                + Number(balances[config.feeMoney()].available)).toFixed(2))
        }
    }

    if (orders.length > 0) console.table(orders.sort((a, b) => b.plusValue - a.plusValue))
    if (new_orders.length > 0) console.table(new_orders)
    console.table(stateCurrencies)
    console.table(stateBalance)

    new Promise(res => setTimeout(res, config.refresh())).finally(() => gB());
}

// Start bot
gB();
